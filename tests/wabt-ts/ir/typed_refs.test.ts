// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The typed-ref IR refactor: `(ref $T)` / `(ref null $T)` now survive as
// CONCRETE types instead of coarsening to structref.
//
// `FuncSignature { params: Type[]; results: Type[] }` could not carry a heap
// type index alongside a Ref / RefNull type code -- the `Type` enum's values
// are single wire bytes, but a typed reference encodes as the 0x64 / 0x63
// marker FOLLOWED BY a heap type. So the parser stored `Type.StructRef` as a
// placeholder and the writer emitted a structref byte. Every module using a
// typed ref in a signature, local, global, table, or element type parsed and
// encoded fine and was then rejected by V8. Because it parsed, the
// parse-clean metric could not see it at all.
//
// The IR now uses `ValueType = Type | RefValueType`:
//
//   * `writeValueType` emits the two-part encoding; `readValType` /
//     `readRefType` decode it. Reading one byte used to leave the heap type
//     in the stream, shifting every following field of the entry.
//   * `resolveNames` walks every value-type slot in the module, so a `$T`
//     heap type reaches the writer resolved.
//   * The validator's type-checker and the binaryen bridge still coarsen via
//     `coarsenValueType` -- their surfaces are flat. Encoders must NOT
//     coarsen; that was the bug.
//
// Spec testsuite: fully V8-valid files 187 -> 200, and the whole
// "expected structref, got (ref $t)" cluster is gone.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { isRefValueType } from '../../src/ir/ir.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';
import { Type } from '../../src/core/types.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function v8Accepts(wat: string): boolean {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

/** Compile, run an export, and return its result. */
async function run(wat: string, name: string): Promise<unknown> {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  return (instance.exports[name] as () => unknown)();
}

/** wasm2wat then wat2wasm again; asserts the text form survives. */
function roundTrips(wat: string): boolean {
  const { text, errors } = wasm2wat(compile(wat));
  if (hasErrors(errors) || !text) return false;
  return !hasErrors(wat2wasm(text).errors);
}

describe('typed refs survive as concrete types in the IR', () => {
  it('a (ref null $T) param is not coarsened to structref', () => {
    const { module, errors } = parseWatModule(
      '(module (type $a (array (mut i32))) (func (param (ref null $a))))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const p = module.funcs[0]!.sig.params[0]!;
    assert(isRefValueType(p), `expected a concrete typed ref, got ${JSON.stringify(p)}`);
    assertEquals(p.nullable, true);
    assertEquals(p.heapType.kind === 'name' ? p.heapType.name : '', '$a');
  });

  it('(ref $T) is non-nullable', () => {
    const { module } = parseWatModule(
      '(module (type $a (array (mut i32))) (func (param (ref $a))))',
    );
    const p = module.funcs[0]!.sig.params[0]!;
    assert(isRefValueType(p));
    assertEquals(p.nullable, false);
  });

  it('(ref null func) still collapses to the one-byte funcref', () => {
    // The abstract nullable form IS funcref; keeping it concrete would emit
    // two bytes where one is correct.
    const { module } = parseWatModule('(module (func (param (ref null func))))');
    assertEquals(module.funcs[0]!.sig.params[0], Type.FuncRef);
  });
});

describe('typed refs encode, decode, and execute', () => {
  const shapes: ReadonlyArray<readonly [string, string]> = [
    ['param', '(module (type $a (array (mut i32))) (func (param (ref null $a))))'],
    [
      'result',
      '(module (type $a (array (mut i32))) (func (export "f") (result (ref null $a)) (ref.null $a)))',
    ],
    [
      'non-nullable param',
      '(module (type $a (array (mut i32))) (func (param (ref $a)) (result i32) (array.len (local.get 0))))',
    ],
    ['global', '(module (type $a (array (mut i32))) (global (ref null $a) (ref.null $a)))'],
    ['table element type', '(module (type $t (func)) (table $x 1 (ref null $t)))'],
  ];
  for (const [name, wat] of shapes) {
    it(`${name}: V8 accepts and the text round-trips`, () => {
      assert(v8Accepts(wat), `V8 rejected: ${name}`);
      assert(roundTrips(wat), `round-trip failed: ${name}`);
    });
  }

  it('a typed-ref local works end to end', async () => {
    assertEquals(
      await run(
        `(module (type $a (array (mut i32)))
           (func (export "f") (result i32)
             (local $x (ref null $a))
             (local.set $x (array.new_default $a (i32.const 4)))
             (array.len (local.get $x))))`,
        'f',
      ),
      4,
    );
  });

  it('the GC array-bulk module that could not be V8-verified before now runs', async () => {
    // This exact shape was encoding-only-verified when array.fill landed,
    // because (ref $arr) in the $mk signature coarsened to structref.
    assertEquals(
      await run(
        `(module
          (type $arr (array (mut i32)))
          (func $mk (result (ref $arr)) (array.new_default $arr (i32.const 8)))
          (func (export "f") (result i32)
            (local $a (ref null $arr))
            (local.set $a (call $mk))
            (array.fill $arr (local.get $a) (i32.const 2) (i32.const 42) (i32.const 3))
            (array.get $arr (local.get $a) (i32.const 3))))`,
        'f',
      ),
      42,
    );
  });
});

describe('abstract types keep the compact encoding', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['funcref param', '(module (func (param funcref)))'],
    ['externref global', '(module (global externref (ref.null extern)))'],
    ['anyref result', '(module (func (result anyref) (ref.null any)))'],
    ['plain numerics', '(module (func (param i32 i64 f32 f64) (result i32) (local.get 0)))'],
    ['v128', '(module (func (param v128)))'],
    ['funcref table', '(module (table 1 funcref))'],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected: ${wat}`);
      assert(roundTrips(wat), `round-trip failed: ${wat}`);
    });
  }

  it('a funcref param is still a single byte in the type section', () => {
    const binary = compile('(module (func (param funcref)))');
    // 0x60 (func) 0x01 (1 param) 0x70 (funcref) 0x00 (0 results)
    let found = false;
    for (let i = 0; i + 3 < binary.length; i++) {
      if (
        binary[i] === 0x60 && binary[i + 1] === 0x01 && binary[i + 2] === 0x70 &&
        binary[i + 3] === 0x00
      ) found = true;
    }
    assert(found, 'expected the compact one-byte funcref encoding');
  });
});
