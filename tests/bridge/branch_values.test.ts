// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The bridge DROPPED a `br_table`'s carried values.
//
// wabt-ts holds the values of a folded `(br_table $a (i32.const 7) (i32.const 0))`
// in `BrTableExpr.values` — the index is `value`, the top operand. The bridge
// built its `makeSwitch` from the index and passed `null` for the values, so
// the branch reached a result-typed block carrying nothing and V8 rejected the
// module.
//
// The same drop-at-packing class as every branch-value defect before it (the
// WAT `return`, `br` and `br_table` paths each dropped values into a one-slot
// field). Found when S6 decision 6A gave `makeSwitch` a `values` list, which
// made the missing argument visible at the call site.
//
// The reference is wabt-ts's own `wat2wasm` of the same text — the path that
// never crosses the bridge.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

function bridged(wat: string): Uint8Array {
  const { module, errors } = parseWatModule(new LexerSource(wat, '<branch-values>'));
  if (hasErrors(errors)) throw new Error('parse:\n' + formatErrors(errors));
  const re = makeErrorList();
  resolveNames(module, re);
  if (hasErrors(re)) throw new Error('resolveNames:\n' + formatErrors(re));
  return encodeWasm(bridgeToBinaryen(module));
}

function run(bytes: Uint8Array): unknown {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(buf), {});
  return (inst.exports.run as () => unknown)();
}

const CASES: [string, string][] = [
  [
    'one value',
    `(module (func (export "run") (result i32)
       (block $a (result i32)
         (br_table $a (i32.const 7) (i32.const 0)))))`,
  ],
  [
    // Index 1 selects the DEFAULT, $a, skipping the `+ 100` after $b. (Not
    // multi-value: the bridge refuses multi-value blocks outright, loudly.)
    'one value, two targets',
    `(module (func (export "run") (result i32)
       (block $a (result i32)
         (i32.add
           (block $b (result i32)
             (br_table $b $a (i32.const 7) (i32.const 1)))
           (i32.const 100)))))`,
  ],
  [
    'one value, two targets, index 0 lands in $b',
    `(module (func (export "run") (result i32)
       (block $a (result i32)
         (i32.add
           (block $b (result i32)
             (br_table $b $a (i32.const 7) (i32.const 0)))
           (i32.const 100)))))`,
  ],
];

describe("the bridge keeps a br_table's carried values", () => {
  for (const [name, wat] of CASES) {
    it(name, () => {
      const { binary, errors } = wat2wasm(wat);
      if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
      assertEquals(run(bridged(wat)), run(binary));
    });
  }
});
