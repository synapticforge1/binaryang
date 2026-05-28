// Bug D repro: empty-folded ops should consume preceding stack values.
// `(local.set $x)` with no children should pop 1 from the surrounding stack.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors } from '../../src/core/error.ts';

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
