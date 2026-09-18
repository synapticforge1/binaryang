// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M7c3b b1b (owner decision 4, cmem/names.md): the reader names every entity,
// making a name up where the name section gave none. wasm-objdump prints a
// function's name only when it is REAL — a made-up `$func1` is not the
// module's, and upstream prints only what the section says.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmObjdump } from '../../../src/wabt-ts/tools/wasm-objdump.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function objdump(wat: string): string {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return wasmObjdump(r.binary, { details: true }).text;
}

describe('wasm-objdump prints only REAL function names', () => {
  it('a named function by its name, an unnamed one by its index alone', () => {
    const text = objdump('(module (func $named) (func))');
    assert(text.includes(' - func[0] <$named>'), text);
    assert(/ - func\[1\]\n/.test(text), text);
    assert(!text.includes('$func1'), text);
  });
});
