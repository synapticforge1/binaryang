// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Code lens pass 3 (2026-10-28): three things wasm-ctor-eval wrote wrongly.
//
// 1. A constructor cut part way re-sets every local at entry from what it held. A NON-nullable
//    reference local not yet assigned held null, so the copy began `local.set $r (ref.null $f)`:
//    an invalid module, reported "partial evalling successful".
// 2. With no passive segment, the repacked image REPLACED the active segments, renumbering them —
//    a `data.drop 1` then named a segment past the end ("data_segment variable out of range").
// 3. A constructor with an empty body completes having run 0 statements, and was skipped as if
//    nothing ran: its export was kept, where upstream removes it.
//
// Every output must validate, and (1) and (2) must still compute what the input computed.

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { ctorEval, type CtorEvalOptions } from '../../../src/tools/wasm-ctor-eval.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';

function evalled(wat: string, options: Partial<CtorEvalOptions>): Uint8Array {
  const r = wat2wasm(wat, { textForm: false, features: allFeatures() });
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const m = readForPasses(r.binary);
  ctorEval(m, { log: undefined, ...options });
  const bytes = writeWasm(m);
  assert(WebAssembly.validate(bytes as BufferSource), 'ctor-eval wrote an invalid module');
  return bytes;
}

const exportsOf = (bytes: Uint8Array) =>
  WebAssembly.Module.exports(new WebAssembly.Module(bytes as BufferSource)).map((e) => e.name);

describe('code lens 3 — wasm-ctor-eval writes valid output', () => {
  it('a cut constructor leaves an unassigned non-nullable local unset', () => {
    const bytes = evalled(
      `(module
        (import "env" "h" (func $h))
        (type $f (func))
        (global $g (export "g") (mut i32) (i32.const 0))
        (func $t (global.set $g (i32.add (global.get $g) (i32.const 10))))
        (elem declare func $t)
        (func (export "ctor") (local $r (ref $f))
          (global.set $g (i32.const 5))
          (call $h)
          (local.set $r (ref.func $t))
          (call_ref $f (local.get $r))))`,
      { ctors: ['ctor'], keptExports: ['ctor'] },
    );
    let hostCalls = 0;
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {
      env: { h: () => hostCalls++ },
    });
    const g = inst.exports['g'] as WebAssembly.Global;
    assertEquals(g.value, 5, 'the evaluated global');
    (inst.exports['ctor'] as () => void)();
    assertEquals([hostCalls, g.value], [1, 15], 'the rest of the constructor, as written');
  });

  it('keeps data segment indices when an instruction names one', () => {
    const bytes = evalled(
      `(module (memory (export "mem") 1)
        (data (i32.const 16) "x") (data (i32.const 17) "y")
        (func (export "ctor"))
        (func (export "later") (data.drop 1)))`,
      { ctors: ['ctor'] },
    );
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
    const mem = new Uint8Array((inst.exports['mem'] as WebAssembly.Memory).buffer);
    assertEquals([mem[16], mem[17]], [0x78, 0x79], 'the memory image');
    (inst.exports['later'] as () => void)();
  });

  it('removes the export of a constructor with an empty body, as upstream', () => {
    const bytes = evalled(
      '(module (memory 1) (func (export "ctor")) (func (export "other") (result i32) (i32.const 1)))',
      { ctors: ['ctor'] },
    );
    assertEquals(exportsOf(bytes), ['other']);
  });
});
