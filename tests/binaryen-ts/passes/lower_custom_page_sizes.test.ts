// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// LowerCustomPageSizes (owner, 2026-09-29: "we want V8 to be able to run it").
// V8 has no custom-page-sizes support, so every case here runs the LOWERED
// module on V8 and checks the proposal's semantics: sizes in custom pages,
// growth to the declared maximum, traps at the TRUE byte size (the underlying
// 64 KiB memory is larger), operand order before a trap, active segments, and
// linking through `#pages`.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

function lowered(wat: string): Uint8Array {
  const r = wat2wasm(wat, { textForm: false });
  expect(r.errors).toEqual([]);
  const m = readForPasses(r.binary);
  new PassRunner(m, {}).add('LowerCustomPageSizes').run();
  return writeWasm(m);
}

type Fns = Record<string, (...a: (number | bigint)[]) => unknown>;
function run(wat: string, imports: WebAssembly.Imports = {}): Fns {
  const bytes = lowered(wat);
  const mod = new WebAssembly.Module(bytes as BufferSource); // V8 compiles it: no custom page size left
  return new WebAssembly.Instance(mod, imports).exports as unknown as Fns;
}
const traps = (f: () => unknown) => expect(f).toThrow(WebAssembly.RuntimeError);

const ACCESSORS = `
  (func (export "size") (result i32) memory.size)
  (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0)))
  (func (export "load") (param i32) (result i32) (i32.load8_u (local.get 0)))
  (func (export "load32") (param i32) (result i32) (i32.load offset=1 (local.get 0)))
  (func (export "store") (param i32 i32) (i32.store8 (local.get 0) (local.get 1)))`;

describe('a 1-byte-page memory, lowered, on V8', () => {
  it('sizes and grows in bytes; traps at the true size, not at 64 KiB', () => {
    const f = run(`(module (memory 0 (pagesize 1)) ${ACCESSORS})`);
    expect(f.size!()).toBe(0);
    traps(() => f.load!(0));
    expect(f.grow!(10)).toBe(0);
    expect(f.size!()).toBe(10);
    f.store!(9, 7);
    expect(f.load!(9)).toBe(7);
    traps(() => f.load!(10)); // inside the underlying 64 KiB page, past the 10 bytes
    // A multi-byte access at the edge: bytes 6..9 fit, 7..10 do not (offset 1).
    expect(() => f.load32!(5)).not.toThrow();
    traps(() => f.load32!(6));
  });

  it('crosses a 64 KiB boundary, and refuses past the declared maximum', () => {
    const f = run(`(module (memory 1 70000 (pagesize 1)) ${ACCESSORS})`);
    expect(f.grow!(65535)).toBe(1);
    expect(f.grow!(1)).toBe(65536);
    f.store!(65536, 3); // the second underlying page exists
    expect(f.load!(65536)).toBe(3);
    expect(f.grow!(70000 - 65537 + 1)).toBe(-1);
    expect(f.grow!(70000 - 65537)).toBe(65537);
    expect(f.size!()).toBe(70000);
    traps(() => f.load!(70000));
  });

  it('evaluates every operand before an out-of-bounds store traps', () => {
    const f = run(`(module (memory 10 (pagesize 1))
      (global $n (mut i32) (i32.const 0))
      (func $bump (result i32) (global.set $n (i32.add (global.get $n) (i32.const 1))) (i32.const 1))
      (func (export "oob") (i32.store8 (i32.const 100) (call $bump)))
      (func (export "n") (result i32) (global.get $n)))`);
    traps(() => f.oob!());
    expect(f.n!()).toBe(1);
  });

  it('memory.copy / fill check the true size of each lowered memory', () => {
    const f = run(`(module
      (memory $small 10 (pagesize 1))
      (memory $large 1 (pagesize 65536))
      (data (memory $small) (i32.const 0) "\\11\\22\\33\\44")
      (func (export "to-large") (param i32 i32 i32) (memory.copy $large $small (local.get 0) (local.get 1) (local.get 2)))
      (func (export "fill") (param i32 i32) (memory.fill $small (local.get 0) (i32.const 9) (local.get 1)))
      (func (export "large") (param i32) (result i32) (i32.load8_u $large (local.get 0)))
      (func (export "small") (param i32) (result i32) (i32.load8_u $small (local.get 0))))`);
    f['to-large']!(6, 0, 2);
    expect(f.large!(7)).toBe(0x22);
    traps(() => f['to-large']!(0, 8, 3)); // source 8..10 is past the 10 bytes
    f.fill!(8, 2);
    expect(f.small!(9)).toBe(9);
    traps(() => f.fill!(8, 3));
  });

  it('a 64-bit memory: sizes, grows and traps in bytes', () => {
    const f = run(`(module (memory i64 5 (pagesize 1))
      (func (export "size") (result i64) memory.size)
      (func (export "grow") (param i64) (result i64) (memory.grow (local.get 0)))
      (func (export "load") (param i64) (result i32) (i32.load8_u (local.get 0))))`);
    expect(f.size!()).toBe(5n);
    traps(() => f.load!(5n));
    expect(f.grow!(3n)).toBe(5n);
    expect(f.load!(7n)).toBe(0);
    expect(f.grow!(-1n)).toBe(-1n); // u64 max: past the address space
  });

  it('an active segment past the true size fails instantiation', () => {
    expect(() => run(`(module (memory 3 (pagesize 1)) (data (i32.const 2) "ab"))`)).toThrow(
      WebAssembly.RuntimeError,
    );
    expect(() => run(`(module (memory 3 (pagesize 1)) (data (i32.const 1) "ab"))`)).not.toThrow();
  });

  it('an explicit (pagesize 65536) is written as the default', () => {
    const f = run(`(module (memory 1 (pagesize 65536)) ${ACCESSORS})`);
    expect(f.size!()).toBe(1);
  });
});

describe('linking lowered modules', () => {
  it('an exported memory brings its #pages global; a lowered importer shares the size', () => {
    const exporter = new WebAssembly.Instance(
      new WebAssembly.Module(
        lowered(`(module (memory (export "mem") 4 (pagesize 1))
          (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0))))`) as BufferSource,
      ),
    ).exports as unknown as Fns & {
      'mem#pagesize=1': WebAssembly.Memory;
      'mem#pages': WebAssembly.Global;
    };
    expect(exporter['mem#pages'].value).toBe(4);
    const f = run(`(module (memory (import "m" "mem") 4 (pagesize 1)) ${ACCESSORS})`, {
      m: exporter as unknown as WebAssembly.ModuleImports,
    });
    expect(f.size!()).toBe(4);
    exporter.grow!(2);
    expect(f.size!()).toBe(6); // one size, seen from both
    traps(() => f.load!(6));
    // The memory is exported under its lowered name only (P1).
    expect('mem' in exporter).toBe(false);
  });

  it('a NATIVE 64 KiB importer of a lowered memory does not link (P1)', () => {
    // It would read and write past the logical size without a trap. The
    // proposal calls this link an error, and so does the engine now.
    const exporter = new WebAssembly.Instance(
      new WebAssembly.Module(
        lowered(`(module (memory (export "mem") 4 (pagesize 1)))`) as BufferSource,
      ),
    ).exports;
    const native = wat2wasm(`(module (memory (import "m" "mem") 0))`).binary;
    expect(() =>
      new WebAssembly.Instance(new WebAssembly.Module(native as BufferSource), {
        m: exporter as unknown as WebAssembly.ModuleImports,
      })
    ).toThrow(WebAssembly.LinkError);
  });

  it('memory exposed by memory.grow is ZERO, whatever was written into the slack', () => {
    // The underlying 64 KiB page is larger than the logical memory, and a host
    // sees all of it through `buffer`. Bytes written there must not come back
    // as "fresh" memory when the module grows over them.
    const i = new WebAssembly.Instance(
      new WebAssembly.Module(
        lowered(`(module (memory (export "mem") 4 (pagesize 1)) ${ACCESSORS})`) as BufferSource,
      ),
    ).exports as unknown as Fns & { 'mem#pagesize=1': WebAssembly.Memory };
    new Uint8Array(i['mem#pagesize=1'].buffer)[10] = 7; // past the 4 logical bytes
    new Uint8Array(i['mem#pagesize=1'].buffer)[65535] = 5; // the last byte of the underlying page
    expect(i.grow!(8)).toBe(4);
    expect(i.load!(10)).toBe(0);
    // Across a 64 KiB boundary: the old page's slack is zeroed, the new page is the engine's.
    expect(i.grow!(70000)).toBe(12);
    expect(i.load!(65535)).toBe(0);
    expect(i.load!(69999)).toBe(0);
  });

  it('a SHARED custom-page memory is refused, loudly', () => {
    expect(() => lowered(`(module (memory 1 2 shared (pagesize 1)))`)).toThrow(/SHARED/);
  });
});
