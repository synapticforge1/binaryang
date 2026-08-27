// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Regression: `ref.null H` could not encode for ANY heap type.
//
// `RefNullExpr.refType` is a `Var`, but it holds a HEAP TYPE — not a reference
// into an item index space. Three separate defects stacked up on that:
//
//   1. The parser routed the immediate through `parseValueType()` and then
//      `typeToName()`, a 3-entry switch whose `default` collapsed everything
//      to `'funcref'`. So `ref.null any` / `eq` / `i31` / `none` / `nofunc` /
//      `noextern` all silently became a funcref null. `struct` / `array` /
//      `exn` never even parsed — each has its own token type (they double as
//      composite-type / refkind keywords), so `parseValueType` rejected them.
//      `ref.null $T` was rejected for the same reason.
//   2. `resolveNames` had no `'ref.null'` case at all, so the name-var was
//      never resolved — and the binary writer's fail-loud `writeVar` rejected
//      every single `ref.null` with `unresolved name-var "funcref"`. The
//      error's advice ("run resolveNames before encoding") was unactionable:
//      resolveNames HAD run, it just didn't know about this node.
//   3. The validator read a name-form refType as plain `Type.FuncRef`, so
//      `(func (result funcref) (ref.null extern))` type-checked clean.
//
// The immediate is now parsed, resolved, encoded, decoded, and printed as a
// heap type — the same path `ref.test` / `ref.cast` already used. V8 accepts
// every binary below.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript } from '../../src/parser/wast-parser.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Result } from '../../src/core/result.ts';
import { Type } from '../../src/core/types.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary, 'expected a binary');
  return binary;
}

/** The `ref.null` immediate byte: the operand right after opcode 0xd0. */
function refNullImmediate(binary: Uint8Array): number {
  const i = binary.lastIndexOf(0xd0);
  assert(i >= 0, 'expected a ref.null opcode (0xd0) in the binary');
  return binary[i + 1] ?? -1;
}

// Every abstract heap type, with the single negative byte the spec assigns it.
const ABSTRACT_HEAP_TYPES: ReadonlyArray<readonly [string, number]> = [
  ['func', 0x70],
  ['extern', 0x6f],
  ['exn', 0x69],
  ['any', 0x6e],
  ['eq', 0x6d],
  ['i31', 0x6c],
  ['struct', 0x6b],
  ['array', 0x6a],
  ['none', 0x71],
  ['nofunc', 0x73],
  ['noextern', 0x72],
  // Bottom of the exn hierarchy. The encoding is -0x0c (0x74) — adjacent to
  // `nofunc` (-0x0d), NOT below `exn` (0x69) as the hierarchy suggests.
  // Verified against V8: 0x68 is rejected, 0x74 accepted. `Type` had no
  // entry for it at all before this fix (12 uses in the spec testsuite).
  ['noexn', 0x74],
];

describe('ref.null — abstract heap types', () => {
  for (const [name, byte] of ABSTRACT_HEAP_TYPES) {
    it(`${name} encodes as 0x${byte.toString(16)} and V8 accepts it`, () => {
      const binary = compile(`(module (func (drop (ref.null ${name}))))`);
      assertEquals(refNullImmediate(binary), byte);
      assert(WebAssembly.validate(bufOf(binary)), `V8 rejected ref.null ${name}`);
    });

    it(`${name} survives a wasm2wat → wat2wasm round-trip`, () => {
      const binary = compile(`(module (func (drop (ref.null ${name}))))`);
      const { text, errors } = wasm2wat(binary);
      if (hasErrors(errors)) throw new Error('wasm2wat:\n' + formatErrors(errors));
      assert(text);
      // The keyword must come back verbatim — not the raw byte as an index
      // (the reader used to stash 0x70 in an INDEX var) and not the type
      // entry's kind (the WAT writer used to print that for index vars).
      assert(
        text.includes(`ref.null ${name}`),
        `expected "ref.null ${name}" in wasm2wat output, got:\n${text}`,
      );
      assertEquals(refNullImmediate(compile(text)), byte);
    });
  }
});

describe('ref.null — nullexnref / noexn', () => {
  it('nullexnref works as a value type', () => {
    assert(v8Accepts(compile('(module (func (result nullexnref) (ref.null noexn)))')));
  });

  it('noexn is a subtype of exnref', () => {
    assert(v8Accepts(compile('(module (func (result exnref) (ref.null noexn)))')));
  });

  it('noexn is NOT a subtype of funcref', () => {
    const { binary, errors } = wat2wasm('(module (func (result funcref) (ref.null noexn)))');
    const bad = hasErrors(errors) || (binary !== undefined && !v8Accepts(binary));
    assert(bad, 'expected noexn to be rejected in a funcref result');
  });
});

describe('ref.null — legacy `…ref` spellings', () => {
  it('funcref normalizes to the func heap type', () => {
    assertEquals(refNullImmediate(compile('(module (func (drop (ref.null funcref))))')), 0x70);
  });

  it('externref normalizes to the extern heap type', () => {
    assertEquals(refNullImmediate(compile('(module (func (drop (ref.null externref))))')), 0x6f);
  });

  it('rejects a non-reference value type', () => {
    const { errors } = wat2wasm('(module (func (drop (ref.null i32))))');
    assert(hasErrors(errors), 'expected `ref.null i32` to be rejected');
  });
});

describe('ref.null — user-defined heap types', () => {
  it('resolves $T to its type index', () => {
    // $S is type index 1 — a name-var that used to encode as index 0 (or, for
    // ref.null specifically, not at all).
    const binary = compile(
      `(module (type $F (func)) (type $S (struct (field i32)))
         (func (drop (ref.null $S))))`,
    );
    assertEquals(refNullImmediate(binary), 1);
    assert(WebAssembly.validate(bufOf(binary)));
  });

  it('accepts a numeric heap-type index', () => {
    const binary = compile(
      `(module (type $F (func)) (type $S (struct (field i32)))
         (func (drop (ref.null 1))))`,
    );
    assertEquals(refNullImmediate(binary), 1);
  });
});

describe('ref.null — real positions', () => {
  it('types a function result correctly', () => {
    const binary = compile('(module (func (export "f") (result externref) (ref.null extern)))');
    assertEquals(wasmValidate(binary).result, Result.Ok);
    assert(WebAssembly.validate(bufOf(binary)));
  });

  it('initializes a global', () => {
    const binary = compile('(module (global (export "g") externref (ref.null extern)))');
    assert(WebAssembly.validate(bufOf(binary)));
  });

  it('works in an element segment item', () => {
    const binary = compile(
      '(module (table 2 funcref) (elem (i32.const 0) funcref (item (ref.null func))))',
    );
    assert(WebAssembly.validate(bufOf(binary)));
  });

  it('parses in linear (unfolded) form', () => {
    const binary = compile('(module (func (result externref) ref.null extern))');
    assert(WebAssembly.validate(bufOf(binary)));
  });

  it('rejects a heap-type mismatch instead of assuming funcref', () => {
    // The validator used to read every name-form refType as funcref, so this
    // module type-checked clean and only V8 caught it.
    const { binary, errors } = wat2wasm('(module (func (result funcref) (ref.null extern)))');
    const bad = hasErrors(errors) || (binary !== undefined && !WebAssembly.validate(bufOf(binary)));
    assert(bad, 'expected `(result funcref) (ref.null extern)` to be rejected');
    if (binary !== undefined) {
      assertEquals(wasmValidate(binary).result, Result.Error);
    }
  });
});

describe('ref.null — wast assert_return result form', () => {
  // `result ::= … | (ref.null) | (ref.null <heaptype>)`. The bare form means
  // "a null of ANY heap type"; the sibling bare `(ref.func)` was already
  // accepted here, so rejecting `(ref.null)` was an inconsistency that
  // hard-errored with "expected heap type, got )".
  function expectedOf(src: string) {
    const { script, errors } = parseWastScript(src);
    if (hasErrors(errors)) throw new Error('parseWastScript:\n' + formatErrors(errors));
    const cmd = script.commands.find((c) => c.kind === 'assert_return');
    assert(cmd && cmd.kind === 'assert_return', 'expected an assert_return command');
    return cmd.expected;
  }

  const MODULE = '(module (func (export "e") (result externref) (ref.null extern)))';

  it('bare (ref.null) parses and omits refType', () => {
    const expected = expectedOf(`${MODULE}\n(assert_return (invoke "e") (ref.null))`);
    assertEquals(expected.length, 1);
    const e = expected[0];
    assert(e && e.kind === 'ref.null');
    // Omitted, NOT defaulted to funcref — a runner must accept any null here
    // rather than compare against a type the script never specified.
    assertEquals(e.refType, undefined);
  });

  it('(ref.null H) still carries its heap type', () => {
    const expected = expectedOf(`${MODULE}\n(assert_return (invoke "e") (ref.null extern))`);
    const e = expected[0];
    assert(e && e.kind === 'ref.null');
    assertEquals(e.refType, Type.ExternRef);
  });

  it('parses a ref_null.wast-shaped script end to end', () => {
    const { script, errors } = parseWastScript(`
      (module
        (func (export "externref") (result externref) (ref.null extern))
        (func (export "funcref") (result funcref) (ref.null func))
        (func (export "ref") (result anyref) (ref.null any))
        (global externref (ref.null extern))
        (global funcref (ref.null func))
      )
      (assert_return (invoke "externref") (ref.null extern))
      (assert_return (invoke "funcref") (ref.null func))
      (assert_return (invoke "ref") (ref.null any))
      (assert_return (invoke "externref") (ref.null))
    `);
    if (hasErrors(errors)) throw new Error('parseWastScript:\n' + formatErrors(errors));
    assertEquals(script.commands.length, 5);
  });
});

function v8Accepts(binary: Uint8Array): boolean {
  return WebAssembly.validate(bufOf(binary));
}

function bufOf(binary: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return buf;
}
