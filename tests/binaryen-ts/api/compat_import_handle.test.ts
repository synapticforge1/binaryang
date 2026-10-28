// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (a), divergence CL19 (2026-10-28), measured against binaryen.js 132:
// - `getFunction` on an IMPORTED function returned null; binaryen.js returns a handle whose
//   `getFunctionInfo` has its `module` and `base`.
// - `i64.const(low, high)` dropped `high` silently; binaryen.js aborts ("i64.const now takes a
//   single argument"). (exnref's ID, the third CL19 item, is in the ID register: a1618195c.)

import { describe, it } from 'node:test';
import { assertEquals, assertThrows } from '@std/assert';

import * as binaryen from '../../../src/compat/binaryen-compat.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const BYTES = wat2wasm(
  '(module (import "env" "imp" (func $imp (param i32) (result i32)))' +
    ' (func (export "f") (result i32) (call $imp (i32.const 1))))',
).binary;

describe('open-work 52 — binaryen facade: import handles, a one-argument i64.const', () => {
  it('getFunction gives an imported function a handle with its module and base', () => {
    const m = binaryen.readBinary(BYTES);
    const handle = m.getFunction('$imp');
    assertEquals(handle !== null, true, 'no handle for the import');
    const info = binaryen.getFunctionInfo(handle!);
    assertEquals([info.module, info.base, info.params, info.results], [
      'env',
      'imp',
      binaryen.i32,
      binaryen.i32,
    ]);
  });

  it('a defined function still reports an empty module and base', () => {
    const m = binaryen.readBinary(BYTES);
    const defined = m.getFunction(m._inner.functions[0]!.name)!;
    const info = binaryen.getFunctionInfo(defined);
    assertEquals([info.module, info.base], ['', '']);
  });

  it('i64.const refuses the old two-argument form, and takes one', () => {
    const m = new binaryen.Module();
    assertThrows(
      () => (m.i64.const as (...a: unknown[]) => unknown)(1, 2),
      Error,
      'i64.const now takes a single argument',
    );
    assertEquals(m.i64.const(5n) !== undefined, true);
  });
});
