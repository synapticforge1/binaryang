// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S7 — the text-form marker: `wat2wasm` → `wasm2wat` gives back the form each
// function was written in (owner, 2026-09-19: "The first rule is fidelity for
// the wat2wasm and wasm2wat… this part transpiles verbatim. The optimization
// does not and is not fidelity tied").
//
// `wat2wasm` records the functions written LINEARLY in a trailing custom
// section, `binaryang.text-form` (`src/wabt-ts/ir/text-form.ts`); every reader
// turns it back into as-written metadata; `wasm2wat` honours it; the
// optimizer drops it with the rest of that metadata. Per FUNCTION: a function
// that mixes the forms is recorded as folded.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmStrip } from '../../../src/wabt-ts/tools/wasm-strip.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { TEXT_FORM_SECTION } from '../../../src/wabt-ts/ir/text-form.ts';

const MIXED_FILE = `(module
  (import "env" "log" (func $log (param i32)))
  (func $lin (export "lin") (param i32) (result i32)
    local.get 0
    i32.const 1
    i32.add)
  (func $fold (export "fold") (param i32) (result i32)
    (i32.mul (local.get 0) (i32.const 2)))
  (func $both (export "both") (param i32) (result i32)
    local.get 0
    (i32.const 3)
    i32.sub))`;

function asm(wat: string, opts: { textForm?: boolean } = {}): Uint8Array {
  const r = wat2wasm(wat, opts);
  assert(r.binary.length > 0 && WebAssembly.validate(r.binary as BufferSource), 'valid');
  return r.binary;
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The payload of the LAST section, if it is the text-form marker. */
function trailingMarker(b: Uint8Array): Uint8Array | null {
  let p = 8, last: Uint8Array | null = null;
  while (p < b.length) {
    const id = b[p++]!;
    let size = 0, shift = 0, byte;
    do {
      byte = b[p++]!;
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    const end = p + size;
    last = null;
    if (id === 0) {
      const n = b[p]!;
      const name = new TextDecoder().decode(b.slice(p + 1, p + 1 + n));
      if (name === TEXT_FORM_SECTION) last = b.slice(p + 1 + n, end);
    }
    p = end;
  }
  return last;
}

/** The body lines of function `name` in `text`, trimmed. */
function bodyOf(text: string, name: string): string {
  const start = text.indexOf(`(func ${name}`);
  assert(start >= 0, `no ${name}:\n${text}`);
  const next = text.indexOf('(func ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

describe('S7 — wat2wasm → wasm2wat keeps each function’s form', () => {
  it('a linear function comes back linear, a folded one folded, a mixed one folded', () => {
    const text = wasm2wat(asm(MIXED_FILE)).text;
    assert(/\n\s+local\.get 0\n\s+i32\.const 1\n\s+i32\.add\)/.test(bodyOf(text, '$lin')), text);
    assert(bodyOf(text, '$fold').includes('(i32.mul'), text);
    assert(bodyOf(text, '$both').includes('(i32.sub'), 'mixed is recorded as folded');
  });

  it('the round trip is a byte fixed point', () => {
    const bytes = asm(MIXED_FILE);
    assert(eq(asm(wasm2wat(bytes).text), bytes));
  });

  it('the section: last, version 1, the LINEAR functions’ indices (imports first)', () => {
    // $log is import 0; $lin is function 1, $fold 2, $both 3 — only $lin is linear.
    assertEquals([...trailingMarker(asm(MIXED_FILE))!], [1, 1, 1]);
  });

  it('a module written folded carries no section at all', () => {
    const folded = '(module (func (export "f") (result i32) (i32.const 1)))';
    assertEquals(trailingMarker(asm(folded)), null);
    assert(eq(asm(folded), asm(folded, { textForm: false })));
  });

  it('`textForm: false` gives the same bytes without the section — upstream wat2wasm’s', () => {
    const on = asm(MIXED_FILE), off = asm(MIXED_FILE, { textForm: false });
    assertEquals(trailingMarker(off), null);
    const marker = trailingMarker(on)!;
    const sectionLength = on.length - off.length;
    assert(
      sectionLength > marker.length && eq(on.slice(0, off.length), off),
      'a trailing section, nothing else',
    );
  });

  it('wasm2wat: `asWritten: false` folds every function; `fold: false` writes every one linearly', () => {
    const bytes = asm(MIXED_FILE);
    assert(bodyOf(wasm2wat(bytes, { asWritten: false }).text, '$lin').includes('(i32.add'));
    assert(!bodyOf(wasm2wat(bytes, { fold: false }).text, '$fold').includes('(i32.mul'));
  });
});

describe('S7 — binaryen-ts: kept without passes, dropped by the optimizer', () => {
  it('decode → encode keeps it', () => {
    const bytes = asm(MIXED_FILE);
    assert(eq(encodeWasm(parseWasm(bytes)), bytes));
  });

  it('an optimized module carries none', () => {
    const m = parseWasm(asm(MIXED_FILE));
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    assertEquals(trailingMarker(encodeWasm(m)), null);
  });
});

describe('S7 — a marker that does not fit is kept raw and ignored', () => {
  /** MIXED_FILE's bytes with the marker's payload replaced by `payload`. */
  function withPayload(payload: number[]): Uint8Array {
    const off = asm(MIXED_FILE, { textForm: false });
    const name = new TextEncoder().encode(TEXT_FORM_SECTION);
    const body = [name.length, ...name, ...payload];
    return new Uint8Array([...off, 0, body.length, ...body]);
  }

  for (
    const [what, payload] of [
      ['an unknown version', [2, 1, 1]],
      ['an imported function', [1, 1, 0]],
      ['an index past the module', [1, 1, 9]],
      ['indices not ascending', [1, 2, 2, 1]],
      ['a trailing byte', [1, 1, 1, 0]],
      ['a truncated count', [1]],
    ] as const
  ) {
    it(`${what}: folded output, and the bytes round-trip`, () => {
      const bytes = withPayload([...payload]);
      const text = wasm2wat(bytes).text;
      assert(bodyOf(text, '$lin').includes('(i32.add'), `ignored → folded:\n${text}`);
      // Kept as raw bytes: every reader, every writer, same bytes back.
      assert(eq(encodeWasm(parseWasm(bytes)), bytes), 'binaryen-ts keeps it raw');
      assert(text.includes(`(@custom "${TEXT_FORM_SECTION}"`), 'wabt-ts keeps it raw');
    });
  }
});

describe('S7 — wasm-strip', () => {
  it('stripping everything drops the marker', () => {
    const stripped = wasmStrip(asm(MIXED_FILE)).binary;
    assertEquals(trailingMarker(stripped), null);
    assert(bodyOf(wasm2wat(stripped).text, '(;1;)').includes('(i32.add'), 'folded once stripped');
  });

  it('stripping another section keeps it; naming it drops it', () => {
    const bytes = asm(MIXED_FILE);
    assertNotEquals(trailingMarker(wasmStrip(bytes, { sections: ['name'] }).binary), null);
    assertEquals(trailingMarker(wasmStrip(bytes, { sections: [TEXT_FORM_SECTION] }).binary), null);
  });
});
