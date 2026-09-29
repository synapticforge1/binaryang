// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8b4 (cmem/ir-convergence.md, item 6 M8): a function keeps the type index its
// binary WROTE (`typeVar`, wabt-ts's field). The encoder re-derived it from the
// signature, which picks the FIRST of several identical types (T1): over the
// spec corpus, 51 binaries re-encoded differently for exactly that reason and
// are byte-identical now. A `typeVar` the signature no longer matches — a pass
// changed it — is not written; the index is derived instead.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}

/** The function section's type indices. */
function funcTypeIndices(bytes: Uint8Array): number[] {
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const b = bytes[i++]!;
      size += (b & 0x7f) * 2 ** s;
      if ((b & 0x80) === 0) break;
    }
    if (id === 3) {
      const count = bytes[i]!;
      return [...bytes.subarray(i + 1, i + 1 + count)];
    }
    i += size;
  }
  return [];
}

describe('M8b4 — a function keeps the type index it was read with', () => {
  it('the SECOND of two identical types survives decode -> encode', () => {
    const bytes = assemble('(module (type $a (func)) (type $b (func)) (func (type $b)))');
    assertEquals(funcTypeIndices(bytes), [1]);
    const mod = readForPasses(bytes);
    assertEquals(mod.functions[0]!.typeVar, varIndex(1));
    assertEquals(writeWasm(mod), bytes);
  });

  it('a stale typeVar is not written: the index follows the signature', () => {
    const mod = readForPasses(
      assemble('(module (type $a (func)) (type $b (func (param i32))) (func (type $a)))'),
    );
    // A pass gives the function a new signature and leaves typeVar behind.
    mod.functions[0]!.sig = { params: [ValType.I32], results: [] };
    mod.functions[0]!.locals = [{ type: ValType.I32 }];
    assertEquals(mod.functions[0]!.typeVar, varIndex(0));
    assertEquals(funcTypeIndices(writeWasm(mod)), [1]);
  });
});
