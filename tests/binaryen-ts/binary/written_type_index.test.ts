// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 decision 7c (cmem/ir-convergence.md): FORM — which type-section index a
// construct's header NAMED, where the same type could have been written another
// way. Two losses, both in binaryen-ts:
//
//   T1  `call_indirect (type $b)` came back `(type $a)` when `$a` was the first
//       structurally identical type: the encoder DERIVED the index by matching
//       the signature, and a module may hold several that match.
//   —   a block header written as a type INDEX came back as an inline value
//       type (`02 00` → `02 7f`). Same type, different bytes.
//
// The signature is on the node either way, so this is form and not meaning: it
// rides on the node (as 7a's `resultType` and 7b(i)'s `params` do, not in
// wabt-ts's side table, which binaryen-ts's IR has no key into) and
// `PassRunner` drops it before the first pass runs.
//
// ⚠️ The third item on 7c's list, T2 — "the encoder DERIVES the type-section
// order, reordering input" — does NOT happen on this path: a decoded module
// keeps the decoder's type list, in its own order, duplicates included. Pinned
// below so the row's claim is not re-copied without a case.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import type { Expression } from '../../../src/binaryen-ts/ir/expressions.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
/** One section's bytes, as hex. */
function section(b: Uint8Array, want: number): string {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === want) {
      return [...b.subarray(i, i + size)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    }
    i += size;
  }
  return '(none)';
}
/** Every node of `kind` in the module's functions. */
function nodesOfKind(bytes: Uint8Array, kind: ExpressionKind): Expression[] {
  const found: Expression[] = [];
  for (const fn of parseWasm(bytes).functions) {
    walkExpression(fn.body, (e) => {
      if (e.kind === kind) found.push(e);
    });
  }
  return found;
}

const IDENTICAL_TYPES = '(module (type $a (func)) (type $b (func)) (table 1 funcref)' +
  ' (func (call_indirect (type $b) (i32.const 0))))';

describe('7c / T1 — call_indirect keeps the type index it named', () => {
  it('the fixture really names the SECOND of two identical types', () => {
    // `11 01 00` — call_indirect, type 1, table 0. Both types are `(func)`.
    assertEquals(section(assemble(IDENTICAL_TYPES), 1), '02 60 00 00 60 00 00');
    assert(section(assemble(IDENTICAL_TYPES), 10).includes('11 01 00'));
  });

  it('decode → encode is byte-identical (it named type 0 before)', () => {
    const bytes = assemble(IDENTICAL_TYPES);
    assert(same(encodeWasm(parseWasm(bytes)), bytes), section(encodeWasm(parseWasm(bytes)), 10));
  });

  it('the node carries the written index', () => {
    const calls = nodesOfKind(assemble(IDENTICAL_TYPES), ExpressionKind.CallIndirect);
    assertEquals(calls.length, 1);
    assertEquals((calls[0] as { typeIndex?: number }).typeIndex, 1);
  });

  it('a module with ONE matching type needs no record to be right', () => {
    const bytes = assemble(
      '(module (type $a (func)) (table 1 funcref) (func (call_indirect (type $a) (i32.const 0))))',
    );
    assert(same(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('return_call_indirect keeps it too', () => {
    const bytes = assemble(
      '(module (type $a (func)) (type $b (func)) (table 1 funcref)' +
        ' (func (return_call_indirect (type $b) (i32.const 0))))',
    );
    assert(same(encodeWasm(parseWasm(bytes)), bytes), section(encodeWasm(parseWasm(bytes)), 10));
  });
});

describe('7c — a block header written as a type index keeps that form', () => {
  const BLOCK_INDEX = '(module (type $t (func (result i32)))' +
    ' (func (result i32) (block (type $t) (i32.const 1))))';

  it('the fixture writes the index form, not the inline one', () => {
    // `02 00` — block, type 0. The inline spelling would be `02 7f`.
    assert(section(assemble(BLOCK_INDEX), 10).includes('02 00 41 01'));
  });

  it('decode → encode is byte-identical (it was `02 7f` before)', () => {
    const bytes = assemble(BLOCK_INDEX);
    assert(same(encodeWasm(parseWasm(bytes)), bytes), section(encodeWasm(parseWasm(bytes)), 10));
  });

  it('a header written INLINE stays inline — the record is per node', () => {
    const bytes = assemble('(module (func (result i32) (block (result i32) (i32.const 1))))');
    assert(section(bytes, 10).includes('02 7f'), section(bytes, 10));
    assert(same(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('an empty header stays `0x40`', () => {
    const bytes = assemble('(module (func (block (nop))))');
    assert(section(bytes, 10).includes('02 40'), section(bytes, 10));
    assert(same(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('loop, if and try_table keep it as well', () => {
    for (
      const wat of [
        '(module (type $t (func (result i32))) (func (result i32) (loop (type $t) (i32.const 1))))',
        '(module (type $t (func (result i32)))' +
        ' (func (result i32) (if (type $t) (i32.const 1) (then (i32.const 2)) (else (i32.const 3)))))',
        '(module (type $t (func (result i32)))' +
        ' (func (result i32) (try_table (type $t) (i32.const 1))))',
      ]
    ) {
      const bytes = assemble(wat);
      assert(same(encodeWasm(parseWasm(bytes)), bytes), `${wat}\n   ${section(bytes, 10)}`);
    }
  });
});

describe('7c — a header WITH parameters keeps the index it named, not the first match', () => {
  // 🛑 Found probing S6 step 5 stage (c): the encoder's parameter branch came
  // FIRST and derived the index by signature, so a header naming the second of
  // two identical types re-encoded as the first (`02 01` → `02 00`). The
  // decoder had recorded `typeIndex: 1`; nothing read it. T1's defect, on the
  // one header shape 7c's tests did not cover.
  const TYPES =
    '(type $a (func (param i32) (result i32))) (type $b (func (param i32) (result i32)))';
  // Linear form, so the entry value is really on the stack before the header.
  const CASES: [string, string, string][] = [
    ['block', 'local.get 0 block (type $b) end', '20 00 02 01 0b'],
    ['loop', 'local.get 0 loop (type $b) end', '20 00 03 01 0b'],
    ['if', 'local.get 0 local.get 0 if (type $b) else end', '20 00 20 00 04 01 0b'],
    ['try_table', 'local.get 0 try_table (type $b) end', '20 00 1f 01 00 0b'],
  ];

  for (const [name, body, header] of CASES) {
    it(`${name}: the fixture names type 1, and decode → encode keeps it`, () => {
      const bytes = assemble(`(module ${TYPES} (func (type $a) ${body}))`);
      assert(section(bytes, 10).includes(header), section(bytes, 10));
      assert(WebAssembly.validate(new Uint8Array(bytes)), 'the fixture itself is valid');
      const out = encodeWasm(parseWasm(bytes));
      assert(same(out, bytes), `${section(bytes, 10)}\n   ${section(out, 10)}`);
    });
  }
});

describe('7c — the form is FIDELITY ONLY: a pass run drops it', () => {
  // 🔧 Recording it unconditionally broke every lowered block-parameter case:
  // the index names a type WITH parameters, and `lowerBlockParams` takes the
  // parameters away, so the header re-declared inputs nothing supplied. The
  // index is only kept while the node still has that signature.
  const PARAMS = '(module (type $t (func (param i32) (result i32)))' +
    ' (func (export "f") (param i32) (result i32) (local.get 0)' +
    ' (block (type $t) (i32.const 1) (i32.add))))';

  it('a parametrised header survives optimization as VALID wasm', () => {
    const m = parseWasm(assemble(PARAMS));
    new PassRunner(m, { optimizeLevel: 2, debugInfo: false }).addDefaultOptimizationPasses().run();
    const out = encodeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), section(out, 10));
  });

  it('and so does one that named an index with no parameters', () => {
    const m = parseWasm(
      assemble(
        '(module (type $t (func (result i32))) (func (export "f") (result i32)' +
          ' (block (type $t) (i32.const 1))))',
      ),
    );
    new PassRunner(m, { optimizeLevel: 2, debugInfo: false }).addDefaultOptimizationPasses().run();
    const out = encodeWasm(m);
    assert(WebAssembly.validate(out as BufferSource), section(out, 10));
  });

  it('with NO pass queued it is still a plain read-and-write: the form stays', () => {
    const bytes = assemble(IDENTICAL_TYPES);
    const m = parseWasm(bytes);
    new PassRunner(m, { optimizeLevel: 0, debugInfo: false }).run();
    assert(same(encodeWasm(m), bytes), section(encodeWasm(m), 10));
  });

  it('a queued pass drops it — the node no longer carries an index', () => {
    const m = parseWasm(assemble(IDENTICAL_TYPES));
    new PassRunner(m, { optimizeLevel: 2, debugInfo: false }).addDefaultOptimizationPasses().run();
    const found: Expression[] = [];
    for (const fn of m.functions) {
      walkExpression(fn.body, (e) => {
        if (e.kind === ExpressionKind.CallIndirect) found.push(e);
      });
    }
    for (const c of found) assertEquals((c as { typeIndex?: number }).typeIndex, undefined);
  });
});

describe("7c / T2 — the type-section ORDER is the decoder's, not derived", () => {
  // The row says the encoder derives the order "when no type is declared". On
  // the decode → encode path it does not: these would both come back reordered
  // if it did.
  for (
    const [name, wat] of [
      [
        'an unused type before the used one',
        '(module (type $unused (func (param f64))) (type $used (func (param i32)))' +
        ' (func (param i32)) (func (param f64)))',
      ],
      [
        'types declared in reverse use order',
        '(module (type $b (func (param i64))) (type $a (func (param i32)))' +
        ' (func (type $a) (param i32)) (func (type $b) (param i64)))',
      ],
      [
        'two identical types, both kept',
        '(module (type $a (func)) (type $b (func)) (func (type $b)))',
      ],
    ] as const
  ) {
    it(name, () => {
      const bytes = assemble(wat);
      assertEquals(section(encodeWasm(parseWasm(bytes)), 1), section(bytes, 1));
    });
  }
});
