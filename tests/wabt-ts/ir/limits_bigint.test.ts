// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.3 — `Limits.initial` / `max` are `bigint`.
//
// They were `number`, which is exact only to 2^53, and the field is u64 for a
// 64-bit memory or table. So a limit near the top of its range was ROUNDED on
// the way in: `0xffff_ffff_ffff_ffff` (2^64-1) became 2^64, and the encoder —
// once it stopped wrapping silently (T13.2) — had to refuse a module the spec
// calls VALID.
//
// `table64.wast` writes exactly that:
//
//     (module definition (table i64 0xffff_ffff_ffff_ffff funcref))
//     (module (table i64 0 0xffff_ffff_ffff_ffff funcref))
//
// The three-engine panel settles it — Wasmtime, the authority, ACCEPTS both,
// and rejects `(memory i64 0x1_0000_0000_0001)` with "memory size must be at
// most", which is the spec ruling exactly. Wasmer rejects every 64-bit limit
// with "invalid var_u32: integer representation too long" — it reads them as
// u32, which is the bug T13.2 fixed here, seen from outside.
//
// The change is deliberately BREAKING on an exported type: a consumer reading
// `limits.initial` as a number gets a compile error at the one site that has to
// handle the wider range, which is the point. The bridge converts at its own
// boundary (binaryen-ts's API is `number`) and REFUSES a value that would not
// survive the conversion, rather than rounding it.
//
// V8-valid 2118 -> 2119 / 2120, agreement 2118 -> 2119 / 2119, round-trip
// 2118 -> 2119 / 2119. The one module left is a 2^48-page `memory i64`, which
// Wasmtime accepts and V8 rejects on its own implementation limit.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { LexerSource } from '../../src/parser/lexer-source.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

const U64_MAX = 18446744073709551615n; // 0xffff_ffff_ffff_ffff

function encode(src: string): Uint8Array {
  const { binary, errors } = wat2wasm(src);
  assert(!hasErrors(errors), `rejected a LEGAL module:\n${src}\n${formatErrors(errors)}`);
  assert(binary);
  return binary;
}
function parsed(src: string) {
  const { module, errors } = parseWatModule(new LexerSource(src, '<test>'));
  assert(!hasErrors(errors), formatErrors(errors));
  return module;
}

describe('T13.3 — a 64-bit limit survives at full width', () => {
  it('parses 2^64-1 exactly, where a number rounded it to 2^64', () => {
    const m = parsed('(module (table i64 0 0xffff_ffff_ffff_ffff funcref))');
    assertEquals(m.tables[0]?.limits.max, U64_MAX);
    // What the old `number` path could not do: 2^64-1 and 2^64 are the SAME
    // JS number, so the value could not have survived as one.
    assertEquals(Number(U64_MAX), Number(U64_MAX + 1n));
  });

  it('round-trips it through the binary and back to text', () => {
    for (
      const [src, printed] of [
        ['(module (table i64 0 0xffff_ffff_ffff_ffff funcref))', '18446744073709551615'],
        ['(module (table i64 0xffff_ffff_ffff_ffff funcref))', '18446744073709551615'],
        ['(module (memory i64 0x1_0000_0000_0000))', '281474976710656'],
        ['(module (memory i64 0x1_0000_0000 0x2_0000_0000))', '8589934592'],
      ] as const
    ) {
      const text = wasm2wat(encode(src)).text!;
      assert(text.includes(printed), `${src}\n  came back as: ${text}`);
    }
  });

  it('decodes back to the same bigint, not a rounded one', () => {
    const bin = encode('(module (table i64 0 0xffff_ffff_ffff_ffff funcref))');
    const again = parsed(wasm2wat(bin).text!);
    assertEquals(again.tables[0]?.limits.max, U64_MAX);
  });

  it('is still VALID — the bound follows the index type', () => {
    for (
      const src of [
        '(module (table i64 0 0xffff_ffff_ffff_ffff funcref))',
        '(module (table i64 0 0x1_0000_0000 funcref))',
        '(module (memory i64 0x1_0000_0000_0000))',
      ]
    ) {
      assertEquals(
        wasmValidate(encode(src), { features: allFeatures() }).result,
        Result.Ok,
        `${src} was rejected`,
      );
    }
  });
});

describe('T13.3 — the bounds that still apply', () => {
  it('rejects a 32-bit limit that does not fit its u32 field', () => {
    // No rounding involved: the field is u32 and 2^32 does not fit, so the
    // encoder refuses by name rather than wrapping to 0.
    const { errors } = wat2wasm('(module (table 0 0x1_0000_0000 funcref))');
    assert(hasErrors(errors));
    assert(/u32 LEB128 out of range: 4294967296/.test(formatErrors(errors)), formatErrors(errors));
  });

  it('rejects a 64-bit MEMORY above the 2^48 page bound', () => {
    const bin = encode('(module (memory i64 0x1_0000_0000_0001))');
    assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Error);
  });

  it('still holds a 32-bit memory to 65536 pages', () => {
    assertEquals(
      wasmValidate(encode('(module (memory 65536))'), { features: allFeatures() }).result,
      Result.Ok,
    );
    assertEquals(
      wasmValidate(encode('(module (memory 65537))'), { features: allFeatures() }).result,
      Result.Error,
    );
  });

  it('still requires max >= initial', () => {
    assertEquals(
      wasmValidate(encode('(module (memory i64 2 1))'), { features: allFeatures() }).result,
      Result.Error,
    );
  });
});

describe('T13.3 — a maximum of ZERO is a maximum', () => {
  it('does not read `(memory 0 0 shared)` as having no maximum', () => {
    // The check was `!limits.max`, which is also true for 0n — so a shared
    // memory with a zero maximum was reported as having none at all.
    const bin = encode('(module (memory 0 0 shared))');
    const { errors, result } = wasmValidate(bin, { features: allFeatures() });
    assert(
      !/shared memories must have max sizes/.test(formatErrors(errors)),
      formatErrors(errors),
    );
    assertEquals(result, Result.Ok);
  });

  it('still reports a shared memory that really has no maximum', () => {
    const { errors } = wasmValidate(encode('(module (memory 1 shared))'), {
      features: allFeatures(),
    });
    assert(/shared memories must have max sizes/.test(formatErrors(errors)), formatErrors(errors));
  });

  it('keeps a zero maximum through a round trip', () => {
    const text = wasm2wat(encode('(module (memory 0 0))')).text!;
    assert(/\(memory[^)]*0 0\)/.test(text), text);
  });
});

describe('T13.3 — the ordinary sizes are untouched', () => {
  it('parses and prints the everyday ones', () => {
    for (
      const [src, printed] of [
        ['(module (memory 1))', '1'],
        ['(module (memory 1 256))', '256'],
        ['(module (table 10 funcref))', '10'],
        ['(module (memory 1 shared) (memory 2 3 shared))', '2 3'],
      ] as const
    ) {
      const text = wasm2wat(encode(src)).text!;
      assert(text.includes(printed), `${src}\n  came back as: ${text}`);
    }
  });

  it('gives a data-derived memory the right page count', () => {
    const m = parsed('(module (memory (data "abc")))');
    assertEquals(m.memories[0]?.limits.initial, 1n);
  });
});
