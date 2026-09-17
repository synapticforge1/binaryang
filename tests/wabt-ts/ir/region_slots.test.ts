// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, stage (d2): every region slot holds a `RegionExpr` — S6 Group 2
// decision 5 (owner), which binaryen-ts has held since `365e9277c`: the body of
// a `loop`, `try`, `try_table`, each catch, and each `if` arm.
//
// 🔧 wabt-ts held `Expr[]`, and one state had no spelling: `ifFalse: []` was both
// NO `else` and an explicit EMPTY one. So the binary reader dropped a valid
// `else` byte — `04 40 01 05 0b` read and wrote back as `04 40 01 0b`. Different
// bytes, same behaviour, no diagnostic. `ifFalse` is `RegionExpr | null` now.
//
// Upstream wabt drops that byte too (its IR cannot hold it); `wasm-tools` keeps
// it. Text cannot spell the difference at all, so the text paths keep upstream's
// rule: `(else)` with no instructions is no `else`, and `wasm2wat` prints an
// `else` only when it has instructions.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type { Expr, Module } from '../../../src/wabt-ts/ir/ir.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** `(func)` of type `() -> ()` with `body` as its code, byte for byte. */
function moduleWith(body: number[], types = [0x01, 0x60, 0x00, 0x00]): Uint8Array {
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, types.length, ...types],
    ...[0x03, 0x02, 0x01, 0x00],
    ...[0x0a, body.length + 2, 0x01, body.length, ...body],
  ]);
}

function read(bytes: Uint8Array): Module {
  const errors = makeErrorList();
  const m = readBinaryIr(bytes, errors);
  assert(!hasErrors(errors), formatErrors(errors));
  return m;
}

function firstOf<K extends Expr['kind']>(m: Module, kind: K): Extract<Expr, { kind: K }> {
  const stack: unknown[] = [m.functions[0]!.body.children];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if ((v as { kind?: unknown }).kind === kind) return v as Extract<Expr, { kind: K }>;
    stack.push(...Object.values(v));
  }
  throw new Error(`no ${kind}`);
}

// i32.const 1; if (void) nop [else] end
const NO_ELSE = moduleWith([0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x0b, 0x0b]);
const EMPTY_ELSE = moduleWith([0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x05, 0x0b, 0x0b]);

describe('an `if` without an else, and with an EMPTY one, are two states', () => {
  it('the fixtures are both valid wasm', () => {
    assert(WebAssembly.validate(new Uint8Array(NO_ELSE)));
    assert(WebAssembly.validate(new Uint8Array(EMPTY_ELSE)));
  });

  it('the reader: `null` for none, an empty region for an empty one', () => {
    assertEquals(firstOf(read(NO_ELSE), 'if').ifFalse, null);
    const e = firstOf(read(EMPTY_ELSE), 'if').ifFalse;
    assert(e !== null, 'an explicit empty else must not read as none');
    assertEquals(e.kind, 'region');
    assertEquals(e.children, []);
  });

  it('read -> write keeps the `else` byte (it was dropped: `05` vanished)', () => {
    const noNames = { writeDebugNames: false };
    assertEquals(hex(writeBinaryIr(read(EMPTY_ELSE), noNames)), hex(EMPTY_ELSE));
    assertEquals(hex(writeBinaryIr(read(NO_ELSE), noNames)), hex(NO_ELSE));
  });

  it('a decoded empty else with parameters validates as an else, and writes back', () => {
    // `(param i32) (result i32)`: the empty else passes its input through. The
    // validator now visits it as an ELSE (it was read as no else at all).
    const types = [0x02, 0x60, 0x00, 0x00, 0x60, 0x01, 0x7f, 0x01, 0x7f];
    // i32.const 5; i32.const 1; if (type 1) else end; drop
    const ok = moduleWith(
      [0x00, 0x41, 0x05, 0x41, 0x01, 0x04, 0x01, 0x05, 0x0b, 0x1a, 0x0b],
      types,
    );
    assert(WebAssembly.validate(new Uint8Array(ok)), 'the fixture itself is valid');
    const errors = makeErrorList();
    validateModule(read(ok), errors, { features: allFeatures() });
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(hex(writeBinaryIr(read(ok), { writeDebugNames: false })), hex(ok));
  });

  it("text keeps upstream wat2wasm's rule: `(else)` with nothing in it is no else", () => {
    // Upstream wat2wasm 1.0.41 writes `04 40 01 0b` for both spellings.
    for (
      const wat of [
        '(module (func (if (i32.const 1) (then (nop)) (else))))',
        '(module (func i32.const 1 if nop else end))',
      ]
    ) {
      const { module, errors } = parseWatModule(wat);
      assert(!hasErrors(errors), formatErrors(errors));
      assertEquals(firstOf(module, 'if').ifFalse, null, wat);
      const r = wat2wasm(wat);
      assert(!hasErrors(r.errors), formatErrors(r.errors));
      assert(hex(r.binary!).includes('41 01 04 40 01 0b 0b'), `${wat}: ${hex(r.binary!)}`);
    }
  });

  it('and wasm2wat prints an else only when it holds instructions, as upstream does', () => {
    for (const fold of [false, true]) {
      assert(!/\belse\b/.test(wasm2wat(EMPTY_ELSE, { fold }).text!), `fold=${fold}`);
    }
    const full = moduleWith([0x00, 0x41, 0x01, 0x04, 0x40, 0x01, 0x05, 0x01, 0x0b, 0x0b]);
    for (const fold of [false, true]) {
      assert(/\belse\b/.test(wasm2wat(full, { fold }).text!), `fold=${fold}`);
    }
  });
});

describe('every region slot is a region, on both producers', () => {
  const WAT = '(module (tag $e)' +
    ' (func (result i32)' +
    '   (loop (nop))' +
    '   (try (do (nop)) (catch $e (nop)) (catch_all (nop)))' +
    '   (block $h (try_table (catch_all $h) (nop)))' +
    '   (if (result i32) (i32.const 1) (then (i32.const 2)) (else (i32.const 3)))))';

  function both(): [string, Module][] {
    const bin = wat2wasm(WAT);
    assert(!hasErrors(bin.errors), formatErrors(bin.errors));
    const text = parseWatModule(WAT);
    assert(!hasErrors(text.errors), formatErrors(text.errors));
    return [['binary reader', read(bin.binary!)], ['text parser', text.module]];
  }

  it('loop, try, each catch, try_table, and both if arms', () => {
    for (const [path, m] of both()) {
      const loop = firstOf(m, 'loop');
      const tr = firstOf(m, 'try');
      const tt = firstOf(m, 'try_table');
      const ife = firstOf(m, 'if');
      const regions = [
        loop.body,
        tr.body,
        ...tr.catches.map((c) => c.body),
        tt.body,
        ife.ifTrue,
        ife.ifFalse,
      ];
      assertEquals(regions.length, 7, path);
      for (const [i, r] of regions.entries()) {
        assertEquals(r?.kind, 'region', `${path} #${i}`);
        assertEquals(r?.children.length, 1, `${path} #${i}`);
      }
    }
  });
});
