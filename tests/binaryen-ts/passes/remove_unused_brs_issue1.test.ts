// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedBrs, issue #1 (reported 2026-11-15 against 3.0.4): a trailing `br` to its own block
// went whenever the statement before it left nothing — but an EARLIER statement in unreachable
// code, `(i32.eqz (br 0))`, left an i32 that only that `br` unwound. Falling through kept it for
// the block's `end`, and -O2, -O3 and -O4 refused their own output ("type mismatch at end of
// block, expected [] but got [i32]"). The reporter's module, at every level, must come out valid
// on our validator and V8's, and behave as the input does.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

const REPORTED = `(module
  (global (export "g") (mut i32) (i32.const 0))
  (func (export "f")
    br 0
    i32.eqz
    block
      br 0
      i32.eqz
      block
        global.get 0
        global.set 0
        br 1
        nop
      end
      drop
    end
    drop))`;

async function run(bytes: Uint8Array): Promise<number> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
  const ex = instance.exports as { f: () => void; g: WebAssembly.Global };
  ex.f();
  return ex.g.value as number;
}

describe('issue #1: a trailing br that unwinds what unreachable code left', () => {
  const input = wat2wasm(REPORTED, { textForm: false, validate: true }).binary;

  it('the input is valid', () => {
    expect(WebAssembly.validate(input as BufferSource)).toBe(true);
  });

  for (const level of [1, 2, 3, 4] as const) {
    it(`-O${level} returns a valid module that behaves as the input`, async () => {
      const out = await wasmOpt(input, { optimizeLevel: level });
      if (typeof out === 'string') throw new Error('wasmOpt returned text, not a binary');
      expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message))
        .toEqual([]);
      expect(WebAssembly.validate(out as BufferSource)).toBe(true);
      expect(await run(out)).toBe(await run(input));
    });
  }
});
