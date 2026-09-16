// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, item 4 (b): a `ValueType` is a VALUE type.
//
// wabt-ts's `ValueType` was `Type | RefValueType`, and `Type` also holds what is
// not a value type — the packed `I8` / `I16` (field storage only), `Void`,
// `Func` / `Struct` / `Array`, and the validator's `Any`. It is
// `ValType | RefValueType` now, binaryen-ts's definition: `StorageType` names a
// field's type, and the validator's stack names `Any`.
//
// 🛑 Narrowing it turned two casts into lies, and each lie hid a validity defect:
// wabt-ts ACCEPTED modules that V8 and upstream reject.
//   - the binary reader returned any byte as a value type: a local of type `i8`
//     (`0x78`) or `0x40`, a param `i8`, a block result `i8` or `0x60` all decoded,
//     and nothing downstream checked. Upstream: "expected valid local type" …
//   - the text parser returned the `i8` / `i16` keywords as value types:
//     `(local i8)` and `(param i16)` parsed. Upstream: "unexpected token i8".
// Spec 100% on four axes never saw it: the testsuite has no such case.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { Type, type ValType } from '../../../src/wabt-ts/core/types.ts';
import type { StorageType, ValueType } from '../../../src/wabt-ts/ir/ir.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

/** `(func)` bodies over `typeSec`, byte for byte. */
function moduleWith(typeSec: number[], code: number[]): Uint8Array {
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, typeSec.length, ...typeSec],
    ...[0x03, 0x02, 0x01, 0x00],
    ...[0x0a, code.length + 2, 0x01, code.length, ...code],
  ]);
}
const FUNC0 = [0x01, 0x60, 0x00, 0x00];

function readErrors(bytes: Uint8Array): string {
  const errors = makeErrorList();
  readBinaryIr(bytes, errors);
  return hasErrors(errors) ? formatErrors(errors) : '';
}

describe('the binary reader rejects a non-value type in a value position', () => {
  const CASES: [string, Uint8Array, string][] = [
    [
      'a local of type i8',
      moduleWith(FUNC0, [0x01, 0x01, 0x78, 0x0b]),
      'expected valid local type',
    ],
    [
      'a local of type 0x40',
      moduleWith(FUNC0, [0x01, 0x01, 0x40, 0x0b]),
      'expected valid local type',
    ],
    [
      'a param of type i8',
      moduleWith([0x01, 0x60, 0x01, 0x78, 0x00], [0x00, 0x0b]),
      'expected valid param type',
    ],
    [
      'a result of type i16',
      moduleWith([0x01, 0x60, 0x00, 0x01, 0x77], [0x00, 0x0b]),
      'expected valid result type',
    ],
    [
      'a block result i8',
      moduleWith(FUNC0, [0x00, 0x02, 0x78, 0x0b, 0x0b]),
      'expected valid block signature type',
    ],
    [
      'a block result 0x60',
      moduleWith(FUNC0, [0x00, 0x02, 0x60, 0x0b, 0x0b]),
      'expected valid block signature type',
    ],
    [
      // The same i8, spelled as a two-byte s33 (`f8 7f` = -8): the reader's
      // multi-byte path checks separately, and upstream's message is identical.
      'a block result i8 as a multi-byte s33',
      moduleWith(FUNC0, [0x00, 0x02, 0xf8, 0x7f, 0x0b, 0x0b]),
      'expected valid block signature type',
    ],
  ];

  for (const [name, bytes, message] of CASES) {
    it(name, () => {
      assert(!WebAssembly.validate(new Uint8Array(bytes)), 'the fixture must be INVALID wasm');
      const errs = readErrors(bytes);
      assert(errs.includes(message), errs || '(accepted)');
    });
  }
});

describe('the text parser rejects a packed keyword in a value position', () => {
  for (
    const wat of [
      '(module (func (local i8)))',
      '(module (func (param i16)))',
      '(module (func (result i8) unreachable))',
      '(module (func (block (result i8) unreachable)))',
      '(module (global i16 (i32.const 0)))',
    ]
  ) {
    it(wat, () => {
      const { errors } = parseWatModule(wat);
      assert(hasErrors(errors), `${wat} parsed`);
      assert(formatErrors(errors).includes('expected value type, got i'), formatErrors(errors));
    });
  }

  it('and through the bare `ref` form, which reads a type keyword of its own', () => {
    // ⚠️ `(local ref i32)` itself is ACCEPTED here and by nothing upstream — a
    // separate, older leniency (divergence W7), left as it was.
    const { errors } = parseWatModule('(module (func (local ref i8)))');
    assert(formatErrors(errors).includes('expected ref kind, got i8'), formatErrors(errors));
  });

  it('fields still take packed types: text, then the binary reader, then the writer', () => {
    const r = wat2wasm(
      '(module (type (struct (field i8) (field (mut i16)))) (type (array (mut i8))))',
    );
    assert(!hasErrors(r.errors), formatErrors(r.errors));
    assert(WebAssembly.validate(new Uint8Array(r.binary!)));
    const errors = makeErrorList();
    const m = readBinaryIr(r.binary!, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    const [s, a] = m.types;
    assert(s?.kind === 'struct' && a?.kind === 'array');
    assertEquals([...s.fields.map((f) => f.type), a.field.type], [Type.I8, Type.I16, Type.I8]);
    assertEquals([...writeBinaryIr(m)], [...r.binary!]);
  });
});

// ---------------------------------------------------------------------------
// Compile-time pins — `deno task check`
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** wabt-ts's `ValueType` is exactly the scalar value types and the typed references. */
const _i32IsValue: ValueType = Type.I32;
const _refIsValue: ValueType = { heapType: { kind: 'index', value: 0 }, nullable: true };
// @ts-expect-error — `Void` is a `Type` and not a value type
const _voidIsNotValue: ValueType = Type.Void;
// @ts-expect-error — `Any` is the validator's stack placeholder, not a value type
const _anyIsNotValue: ValueType = Type.Any;
// @ts-expect-error — a packed type is only a field's STORAGE type
const _i8IsNotValue: ValueType = Type.I8;
const _i8IsStorage: StorageType = Type.I8;
const _valTypeIsSubset: Same<ValType extends Type ? true : false, true> = true;

void [_i32IsValue, _refIsValue, _voidIsNotValue, _anyIsNotValue, _i8IsNotValue, _i8IsStorage];
void _valTypeIsSubset;
