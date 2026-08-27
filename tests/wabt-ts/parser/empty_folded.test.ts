// Bug D repro: empty-folded ops should consume preceding stack values.
// `(local.set $x)` with no children should pop 1 from the surrounding stack.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { formatErrors } from '../../../src/wabt-ts/core/error.ts';

describe('Bug D: empty-folded ops consume preceding stack values', () => {
  it('(local.set $x) after const works (multi-value receive)', async () => {
    const wat = `(module
      (func $two (result i32 i32) (i32.const 11) (i32.const 22))
      (func (export "f") (result i32)
        (local $a i32) (local $b i32)
        (call $two)
        (local.set $b)
        (local.set $a)
        (i32.add (local.get $a) (local.get $b))))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 33);
  });

  it('(drop) with no child pops top of stack', async () => {
    const wat = `(module (func (export "f") (result i32)
      (i32.const 5) (i32.const 9) (drop)))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 5);
  });

  it('(global.set $g) with no child pops top of stack', async () => {
    const wat = `(module
      (global $g (mut i32) (i32.const 0))
      (func (export "f") (result i32)
        (i32.const 7) (global.set $g) (global.get $g)))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 7);
  });

  it('(return) with no child returns values from stack', async () => {
    const wat = `(module (func (export "f") (result i32)
      (i32.const 42) (return)))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 42);
  });

  it('Bug F: (br_if N (f64.eq (global.get $i) ...)) resolves $i correctly', async () => {
    // Bug F: br_if with single folded cond and a non-first global inside.
    // The fold has 1 child; br_if's instrInputCount=2 (cond + optional
    // value). The Bug D fix must NOT pad with a nop from the empty
    // outer stack, or the CompareExpr would land in br_if's `value`
    // slot — and resolveNames doesn't recurse into `value`, so the
    // global.get name would never resolve to its actual index.
    const wat = `(module
      (global $a (mut i32) (i32.const 0))
      (global $b (mut i32) (i32.const 0))
      (global $c (mut i32) (i32.const 0))
      (global $i f64 (f64.const 2))
      (func (export "f") (result i32)
        (block (br_if 0 (f64.eq (global.get $i) (f64.const 1))))
        (i32.const 42)))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    // The byte for global.get's index immediately follows opcode 0x23.
    // Should be 0x03 ($i), not 0x00 ($a).
    const idx = r.binary.indexOf(0x23);
    assertEquals(
      r.binary[idx + 1],
      0x03,
      'global.get should resolve to $i (index 3), not $a (index 0)',
    );
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => number;
    };
    assertEquals(inst.f(), 42);
  });

  it('(i32.store) with no child pops addr + value from stack', async () => {
    const wat = `(module
      (memory (export "mem") 1)
      (func (export "f")
        (i32.const 0) (i32.const 99) (i32.store)))`;
    const r = wat2wasm(wat);
    if (r.result !== Result.Ok) console.log('parse errors:\n' + formatErrors(r.errors));
    assertEquals(r.result, Result.Ok);
    const buf = new ArrayBuffer(r.binary.byteLength);
    new Uint8Array(buf).set(r.binary);
    const inst = (await WebAssembly.instantiate(buf)).instance.exports as {
      f: () => void;
      mem: WebAssembly.Memory;
    };
    inst.f();
    assertEquals(new DataView(inst.mem.buffer).getInt32(0, true), 99);
  });
});
