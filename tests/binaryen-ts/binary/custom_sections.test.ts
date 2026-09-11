// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// C3 (cmem/divergences.md): binaryen-ts keeps the custom sections a binary
// carried, each back in the gap it held.
//
// 🔧 The decoder read a custom section's NAME and threw the section away, so a
// decode → encode dropped `producers`, `target_features`, `dylink.0` and every
// DWARF section outright, with no diagnostic. Upstream `wasm-opt` keeps them
// all, through `-O2`; only a `name` section it regenerates.
//
// Where we differ from upstream is the POSITION (register C6): `wasm-opt`
// appends every custom section after the known ones and special-cases only
// `dylink.0` (which a dynamic-linking loader must find first). Recording the
// position each one held covers that case and every other — clang's layout puts
// `.debug_*` BEFORE the name section and `producers` after it, which appending
// cannot reproduce. Probed against wasm-opt 132 on all four of `(no passes)`,
// `-g`, `-O2`, `-O2 -g`.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** The section sequence: known sections by id, custom sections by name. */
function layout(b: Uint8Array): string {
  const out: string[] = [];
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 0) {
      const n = b[i]!;
      out.push(`"${new TextDecoder().decode(b.subarray(i + 1, i + 1 + n))}"`);
    } else out.push(String(id));
    i += size;
  }
  return out.join(' ');
}

const enc = new TextEncoder();
/** A custom section: `name` plus `data`, framed. */
const custom = (name: string, data: number[]): number[] => {
  const body = [name.length, ...enc.encode(name), ...data];
  return [0, body.length, ...body];
};
/** A `name` section naming function 0 — framed as the custom section it is. */
const nameSec = (fn: string): number[] => {
  const sub = [1, 0, fn.length, ...enc.encode(fn)];
  return custom('name', [1, sub.length, ...sub]);
};
/** `(func)` exported as "x", with `customs` spliced in at the given points. */
const mk = (
  before: number[][],
  afterType: number[][],
  atEnd: number[][],
): Uint8Array =>
  new Uint8Array([
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...before.flat(),
    ...[1, 4, 1, 0x60, 0, 0],
    ...afterType.flat(),
    ...[3, 2, 1, 0],
    ...[7, 5, 1, 1, 0x78, 0, 0],
    ...[10, 4, 1, 2, 0, 0x0b],
    ...atEnd.flat(),
  ]);

describe('C3 — a custom section survives decode → encode, where it stood', () => {
  const THREE = mk(
    [custom('first', [1, 2])],
    [custom('after-type', [3])],
    [custom('last', [0x41, 0x22, 0x5c])],
  );

  it('the fixture is valid and holds three, in three places', () => {
    assert(WebAssembly.validate(THREE as BufferSource));
    assertEquals(layout(THREE), '"first" 1 "after-type" 3 7 10 "last"');
  });

  it('decode → encode is byte-identical', () => {
    assert(same(encodeWasm(parseWasm(THREE)), THREE), hex(encodeWasm(parseWasm(THREE))));
  });

  it('the module carries them, with the section each one followed', () => {
    const m = parseWasm(THREE);
    assertEquals(
      m.customSections?.map((c) => `${c.name}@${c.precedingSection}`),
      ['first@null', 'after-type@1', 'last@10'],
    );
  });

  it('`dylink.0` stays FIRST — the one position upstream also keeps', () => {
    // A loader reads it before instantiating; appended, it is useless.
    const bytes = mk([custom('dylink.0', [0, 0, 0, 0, 0])], [], []);
    assertEquals(layout(encodeWasm(parseWasm(bytes))), '"dylink.0" 1 3 7 10');
  });

  it("clang's layout — DWARF, then the name section, then producers — keeps its order", () => {
    // The case appending cannot reproduce: customs on BOTH sides of the name
    // section. (1 of 376 real WASI binaries is laid out exactly like this.)
    const bytes = assemble('(module (func $f (export "x")))');
    const withDwarf = new Uint8Array([
      ...bytes.subarray(0, bytes.length - nameSectionLength(bytes)),
      ...custom('.debug_info', [1, 2]),
      ...bytes.subarray(bytes.length - nameSectionLength(bytes)),
      ...custom('producers', [0]),
    ]);
    assertEquals(layout(withDwarf), '1 3 7 10 ".debug_info" "name" "producers"');
    assert(
      same(encodeWasm(parseWasm(withDwarf)), withDwarf),
      layout(encodeWasm(parseWasm(withDwarf))),
    );
  });

  it('a module with none gains none', () => {
    // Hand-built, so there is no `name` section either — `wat2wasm` writes one
    // for every module now (N1), and its place is a custom entry.
    const bytes = mk([], [], []);
    assertEquals(parseWasm(bytes).customSections, undefined);
    assert(same(encodeWasm(parseWasm(bytes)), bytes), layout(encodeWasm(parseWasm(bytes))));
  });

  it("a wat2wasm binary carries just the name section's place", () => {
    const bytes = assemble('(module (func $f (export "x")))');
    assertEquals(
      parseWasm(bytes).customSections?.map((c) => `${c.name}@${c.precedingSection}:${c.data}`),
      ['name@10:null'],
    );
    assert(same(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('a module built through the API has none, and still writes no section', () => {
    const b = new ModuleBuilder();
    b.addFunction('$f', [], [], []);
    const out = encodeWasm(b.build());
    assertEquals(layout(out), '1 3 10');
  });
});

/** The length of the trailing `name` section of a binary wat2wasm just wrote. */
function nameSectionLength(b: Uint8Array): number {
  let last = 0;
  for (let i = 8; i < b.length;) {
    const start = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id === 0) last = i - start;
    else last = 0;
  }
  return last;
}

describe('C3 — the `name` section is regenerated AT ITS PLACE', () => {
  it('a custom after the name section stays after it', () => {
    const bytes = mk([], [], [nameSec('a'), custom('producers', [0])]);
    assertEquals(layout(bytes), '1 3 7 10 "name" "producers"');
    assertEquals(layout(encodeWasm(parseWasm(bytes))), '1 3 7 10 "name" "producers"');
  });

  it("two name sections: one is written, at the LAST one's place", () => {
    // The names come from the last (`findNameSection`), as upstream binaryen,
    // wabt and wasm-tools all read them; binaryen writes one section back.
    const bytes = mk([], [], [nameSec('a'), custom('producers', [0]), nameSec('b')]);
    const out = encodeWasm(parseWasm(bytes));
    assertEquals(layout(out), '1 3 7 10 "producers" "name"');
    assert(new TextDecoder().decode(out).includes('b'), hex(out));
  });

  it('and the surviving name section really is the last one, not the first', () => {
    const bytes = mk([], [], [nameSec('a'), nameSec('b')]);
    const out = encodeWasm(parseWasm(bytes));
    assertEquals(layout(out), '1 3 7 10 "name"');
    assertEquals(parseWasm(out).functions[0]!.name, '$b');
  });
});

describe('C3 — passes keep them, as upstream keeps them', () => {
  // A name section as well, so the run also covers what the name section's
  // PLACE does when the names are gone: nothing, not an empty section.
  const PROBE = mk(
    [custom('dylink.0', [0, 0, 0, 0, 0])],
    [],
    [nameSec('f'), custom('producers', [0])],
  );

  const run = (debugInfo: boolean, passes: boolean): Uint8Array => {
    const m = parseWasm(PROBE);
    const runner = new PassRunner(m, { optimizeLevel: 2, debugInfo });
    if (passes) runner.addDefaultOptimizationPasses();
    runner.run();
    return encodeWasm(m);
  };

  it('optimized without -g: the names go, the custom sections stay', () => {
    // `wasm-opt -O2` does the same: "dylink.0" 1 3 7 10 "producers", no name.
    assertEquals(layout(run(false, true)), '"dylink.0" 1 3 7 10 "producers"');
  });

  it('optimized with -g: both stay, and the name section keeps its place', () => {
    assertEquals(layout(run(true, true)), '"dylink.0" 1 3 7 10 "name" "producers"');
  });

  it('with no pass run it is a plain read-and-write: every section, in order', () => {
    // Not byte-identical, and not because of the custom sections: this
    // fixture's `name` section is hand-written WITHOUT the local-names
    // subsection, which the encoder always writes (N6 in the register — a real
    // producer omits the functions that have no local names, and we do not).
    const out = run(false, false);
    assertEquals(layout(out), '"dylink.0" 1 3 7 10 "name" "producers"');
    assertEquals(parseWasm(out).functions[0]!.name, '$f');
  });

  it('the custom sections themselves come back byte for byte', () => {
    const noNames = mk([custom('dylink.0', [0, 0, 0, 0, 0])], [], [custom('producers', [0])]);
    const m = parseWasm(noNames);
    new PassRunner(m, { optimizeLevel: 2, debugInfo: false }).run();
    assert(same(encodeWasm(m), noNames), layout(encodeWasm(m)));
  });
});
