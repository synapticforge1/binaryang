// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 50, divergence CL9 (2026-10-28): `wasm-opt x.wasm --dce -S` printed `(func (;0;) …)`
// — no names — where upstream prints `$add`. `-S` read its text back from bytes optimized without
// `-g`, which drops the name section. Text output keeps the names now, as upstream's printer
// does; a BINARY written without `-g` still has none (optimized output follows `-g`, N1).

import { describe, it } from 'node:test';
import { assert } from '@std/assert';

import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';

const WAT = `(module
  (import "env" "imp" (func $imp (param i32) (result i32)))
  (func $add (export "add") (param $a i32) (param $b i32) (result i32)
    (i32.add (local.get $a) (call $imp (local.get $b)))))`;

describe('open-work 50 — wasm-opt <pass> -S keeps the names', () => {
  it('prints the names after a pass, as with no pass', async () => {
    const bytes = wat2wasm(WAT).binary;
    for (const passes of [['DCE'], []]) {
      const text = await wasmOpt(bytes, { passes, emitText: true });
      assert(typeof text === 'string');
      assert(text.includes('$add') && text.includes('$imp'), `${passes}: ${text}`);
    }
  });

  it('a binary written without -g still drops them', async () => {
    const out = await wasmOpt(wat2wasm(WAT).binary, { passes: ['DCE'] });
    assert(out instanceof Uint8Array);
    const hasNameSection = new TextDecoder('latin1').decode(out).includes('\u0004name');
    assert(!hasNameSection, 'the optimized binary kept its name section without -g');
  });
});
