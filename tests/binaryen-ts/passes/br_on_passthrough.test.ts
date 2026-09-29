// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Found by the proposals behaviour gate on its first run (2026-09-29,
// `proposals/custom-descriptors`, `br_on_cast_desc_eq.wast`) — and not specific
// to descriptors: plain `br_on_cast` below.
//
// A `br_on_*` carries the stack BENEATH its operands to its label when it
// branches, and leaves it there when it falls through. With a later consumer
// of those values, three steps each produced an INVALID module:
//
//   spillStackValues (every -O level) moved them into locals: the branch
//     found 1 value where its label takes 3;
//   Inlining (-O3) put a `br_on` operand inside the wrapper block, away from
//     the values under it;
//   Inlining (-O3) set a MULTI-result operand's last value in the wrapper and
//     left the rest inside it: "expected 0 elements for fallthru, found 2".
//
// And `deriveTypes` typed an allocation `(ref $T)` in a module that speaks
// exact types, so `--flatten` gave `struct.new_desc`'s descriptor an inexact
// temporary (open-work 9).

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat, { textForm: false });
  expect(r.errors).toEqual([]);
  return r.binary;
}

function optimize(bytes: Uint8Array, level: 1 | 2 | 3, pass?: string): Uint8Array {
  const m = readForPasses(bytes);
  const r = new PassRunner(m, { optimizeLevel: level, shrinkLevel: 0 });
  if (pass !== undefined) r.add(pass);
  else r.addDefaultOptimizationPasses();
  r.run();
  return writeWasm(m);
}

// Linear, so the two i32s stay on the stack under the branch.
const PASSTHROUGH = `(module
  (func $eq (param i32 i32)
    local.get 0 local.get 1 i32.ne
    if unreachable end)
  (func $take (param eqref eqref))
  (func (export "falls-through")
    block (result i32 i32 eqref)
      i32.const 1
      i32.const 2
      ref.null none
      br_on_cast 0 eqref (ref struct)
      ref.null none
      call $take
      i32.const 2
      call $eq
      i32.const 1
      call $eq
      return
    end
    unreachable)
  (func (export "branches")
    block (result i32 i32 eqref)
      i32.const 1
      i32.const 2
      ref.null none
      br_on_cast 0 eqref eqref
      unreachable
    end
    ref.null none
    call $take
    i32.const 2
    call $eq
    i32.const 1
    call $eq))`;

describe('a value under a br_on survives optimization', () => {
  for (const level of [1, 2, 3] as const) {
    it(`-O${level}: valid, and both paths still return`, async () => {
      const out = optimize(assemble(PASSTHROUGH), level);
      expect(WebAssembly.validate(out as BufferSource)).toBe(true);
      const { instance } = await WebAssembly.instantiate(out as BufferSource);
      const run = (name: string) => (instance.exports[name] as () => void)();
      expect(() => run('falls-through')).not.toThrow();
      expect(() => run('branches')).not.toThrow();
    });
  }
});

describe('a module that speaks exact types allocates exact', () => {
  const DESC = `(module
    (rec (type $a (descriptor $b) (struct)) (type $b (describes $a) (struct)))
    (func (export "new") (result (ref (exact $a)))
      (struct.new_desc $a (struct.new $b))))`;

  it('--flatten keeps the descriptor temporary exact', () => {
    const out = optimize(assemble(DESC), 1, 'Flatten');
    // V8 needs a flag for custom descriptors; our validator judges the bytes.
    const { errors } = wasmValidate(out, { features: allFeatures() });
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('a module that never mentions exact types keeps (ref $T)', () => {
    const plain = `(module (type $t (struct))
      (func (export "new") (result (ref $t)) (local (ref null $t))
        (local.set 0 (struct.new $t)) (ref.as_non_null (local.get 0))))`;
    const out = optimize(assemble(plain), 1, 'Flatten');
    // Written into a module without the feature, an exact type would not validate.
    expect(WebAssembly.validate(out as BufferSource)).toBe(true);
  });
});
