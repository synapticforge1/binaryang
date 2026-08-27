// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T10.3 — the WAT writer dropped a table's initializer.
//
//     (table $t 10 (ref func) (ref.func $f))
//
// came back from `wasm2wat` as `(table $t 10 (ref func))`. Not cosmetic: a
// NON-NULLABLE element type has no default value, so the spec requires the
// `0x40 0x00 <reftype> <limits> <init>` form for it, and the plain form the
// re-encode produced is rejected outright. It accounted for all 10 of the
// round-trip metric's `INVALID after round-trip (table)` modules.
//
// The binary reader already captured `init`. The blocker was the writer: this
// one is LINEAR (post-order) by design, and the table grammar takes ONE FOLDED
// instruction there with no `(item …)` / `(offset …)` wrapper to hold a linear
// sequence — so wrapping the linear output in parens reparsed as a folded
// expression with a bogus operand.
//
// `writeFoldedConstExpr` supplies the folded form. It is limited to CONSTANT
// expressions, which is what keeps its operand table closed rather than a
// second copy of the instruction set: the spec limits a constant expression to
// the const family, the `ref` forms, `global.get`, extended-const arithmetic
// and the GC allocations. The instruction's own text still comes from the
// ordinary delegate, so no immediate formatting is duplicated.
//
// Round-trip fidelity: spec testsuite 2088 -> 2102 / 2120, files affected
// 14 -> 10, and V8-invalid-after-round-trip 15 -> 5. Campaign metrics unmoved.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { writeWatModule } from '../../src/writer/wat-writer.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toWat(binary: Uint8Array): string {
  const { text, errors } = wasm2wat(binary);
  if (hasErrors(errors)) throw new Error('wasm2wat:\n' + formatErrors(errors));
  assert(text);
  return text;
}

function v8Accepts(binary: Uint8Array): boolean {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

const NON_NULLABLE = '(module (func $f) (table $t 10 (ref func) (ref.func $f)))';

describe('T10.3 — a table initializer survives a wasm2wat round-trip', () => {
  it('keeps a non-nullable table valid, which is the whole point', () => {
    const first = compile(NON_NULLABLE);
    assertEquals(v8Accepts(first), true, 'fixture must start valid');

    const again = compile(toWat(first));
    // Dropping the initializer produced the plain form, which V8 rejects
    // because a non-nullable element type has no default.
    assertEquals(v8Accepts(again), true, 'round-trip produced invalid wasm');
    assertEquals(again, first);
  });

  it('prints it as one folded instruction, as the grammar requires', () => {
    const wat = toWat(compile(NON_NULLABLE));
    const line = wat.split('\n').find((l) => l.includes('(table'));
    assert(line, wat);
    assert(/\(table .*\(ref func\) \(ref\.func /.test(line), line);
  });

  it('round-trips the nullable forms too', () => {
    for (
      const src of [
        '(module (table $t 10 funcref (ref.null func)))',
        '(module (table $t 10 externref (ref.null extern)))',
        '(module (func $f) (table $t 4 funcref (ref.func $f)))',
      ]
    ) {
      const first = compile(src);
      assertEquals(compile(toWat(first)), first, src);
    }
  });

  it('folds a nested constant expression rather than flattening it', () => {
    // `ref.i31` takes an operand, so this is the case a linear emitter cannot
    // express: `(ref.i31 (global.get $g))`, not `global.get $g  ref.i31`.
    const src =
      '(module (global $g i32 (i32.const 7)) (table $t 1 (ref i31) (ref.i31 (global.get $g))))';
    const first = compile(src);
    const wat = toWat(first);
    assert(/\(ref\.i31\s*\(global\.get /.test(wat), wat);
    assertEquals(compile(wat), first);
  });

  it('leaves a table with no initializer alone', () => {
    const first = compile('(module (table $t 10 funcref))');
    const wat = toWat(first);
    assert(!/\(ref\./.test(wat), wat);
    assertEquals(compile(wat), first);
  });

  it('fails loudly rather than dropping a non-constant initializer', () => {
    // The old behaviour was a silent drop, which is how this stayed hidden.
    // Anything the folded emitter cannot express must now be an error.
    const { module, errors } = parseWatModule('(module (table $t 10 funcref (ref.null func)))');
    assert(!hasErrors(errors), formatErrors(errors));
    const table = module.tables[0]!;
    // A `local.get` is not a constant expression and can never appear here;
    // stand one in to prove the writer refuses instead of emitting a table
    // whose initializer has quietly vanished.
    const broken = {
      ...module,
      tables: [{
        ...table,
        init: [{ kind: 'local.get', var: { kind: 'index', value: 0 }, loc: table.loc }],
      }],
    } as typeof module;
    assertThrows(() => writeWatModule(broken), Error, 'not a constant expression');
  });
});
