// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.10 — `Features` must actually gate. Nine of the twenty-one did not.
//
// `wasmValidate(binary, { features })` is public API and `defaultFeatures()`
// documents itself as "ratified proposals enabled, experimental disabled". It
// said `gc: false` and validated a GC module anyway. Measured proposal by
// proposal, only `multiMemory` and `customPageSizes` were enforced; threads,
// gc, memory64, tailCall, exceptions, relaxedSimd, extendedConst,
// functionReferences and wideArithmetic all claimed to be off and were not.
//
// Same class as everything else this campaign has hunted: a switch that reads
// as covered and does nothing, so the CALLER believes it has refused something
// it has not. wazmrt puts it best — *a proposal that ships without a bit here
// is not "enabled by default"; it is unrefusable.*
//
// Three of the nine had no hook of their own and needed gating by OPCODE:
// relaxed SIMD and wide arithmetic are ordinary unary/binary/ternary nodes
// distinguished only by opcode, and extended-const is ordinary arithmetic
// distinguished only by appearing in an INITIALIZER. A gate hung off an
// expression kind would have missed all three.
//
// **No conformance metric moved**, before or after — every harness passes
// `allFeatures()`, which is exactly the configuration a gate cannot affect. The
// canaries were the project's own tests: five files validated GC / EH /
// tail-call modules with the DEFAULT features and passed only because the gates
// were inert. They now declare the features they exercise.
//
// The CLI gained `--enable-<feature>` / `--disable-<feature>` / `--enable-all`
// in the same change. Gating without them would have made `wasm-validate`
// reject most modern wasm with no way to opt in — a worse regression than the
// bug.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures, defaultFeatures } from '../../src/core/feature.ts';
import type { Features } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** One module per proposal, using ONLY that proposal beyond the MVP. */
const USES: [keyof Features, string][] = [
  ['threads', '(module (memory 1 1 shared) (func (drop (i32.atomic.load (i32.const 0)))))'],
  ['gc', '(module (type $t (struct (field i32))) (func (drop (struct.new $t (i32.const 1)))))'],
  ['memory64', '(module (memory i64 1))'],
  ['multiMemory', '(module (memory 1) (memory 1))'],
  ['tailCall', '(module (func $g) (func (return_call $g)))'],
  ['exceptions', '(module (tag $e) (func (throw $e)))'],
  ['customPageSizes', '(module (memory 1 (pagesize 1)))'],
  [
    'functionReferences',
    '(module (type $s (func)) (func (param (ref $s)) (call_ref $s (local.get 0))))',
  ],
  ['extendedConst', '(module (global i32 (i32.add (i32.const 1) (i32.const 2))))'],
  [
    'relaxedSimd',
    '(module (func (result v128) (f32x4.relaxed_madd (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0) (v128.const i32x4 0 0 0 0))))',
  ],
  [
    'wideArithmetic',
    '(module (func (result i64 i64) (i64.add128 (i64.const 1) (i64.const 2) (i64.const 3) (i64.const 4))))',
  ],
];

function encode(src: string): Uint8Array {
  const { binary, errors } = wat2wasm(src);
  assert(!hasErrors(errors) && binary, `${src}\n${formatErrors(errors)}`);
  return binary;
}

describe('T13.10 — a proposal that defaultFeatures() disables is REFUSED', () => {
  for (const [flag, src] of USES) {
    it(`gates ${flag}`, () => {
      const bin = encode(src);
      // Sanity: it must be valid WITH the proposal, or the case proves nothing.
      assertEquals(
        wasmValidate(bin, { features: allFeatures() }).result,
        Result.Ok,
        `${flag}: not valid even under allFeatures — the test module is wrong`,
      );
      const off = { ...allFeatures(), [flag]: false } as Features;
      const v = wasmValidate(bin, { features: off });
      assertEquals(v.result, Result.Error, `${flag}: accepted with the feature switched OFF`);
      // The gate must SAY which feature it wants. The two gates that predate
      // `requireFeature` keep their own established wording (and their own
      // regression tests), so they are matched by phrase rather than by flag.
      const PRE_EXISTING: Partial<Record<string, RegExp>> = {
        multiMemory: /only one memory block allowed/,
        customPageSizes: /custom page sizes not allowed/,
      };
      const want = PRE_EXISTING[flag] ?? new RegExp(flag);
      assert(
        want.test(formatErrors(v.errors)),
        `${flag}: rejected, but the message does not identify the feature:\n${
          formatErrors(v.errors)
        }`,
      );
    });
  }

  it('and defaultFeatures() refuses every proposal it claims to disable', () => {
    const def = defaultFeatures() as unknown as Record<string, boolean>;
    const leaked: string[] = [];
    for (const [flag, src] of USES) {
      if (def[flag] !== false) continue; // it claims to be ON; not this test's business
      if (wasmValidate(encode(src), { features: defaultFeatures() }).result === Result.Ok) {
        leaked.push(flag);
      }
    }
    assertEquals(leaked, [], 'proposals defaultFeatures() claims to disable but accepts');
  });
});

describe('T13.10 — a TYPE uses a proposal as much as an instruction does', () => {
  // Gating only the instructions left these accepted with `gc: false`, and with
  // them `any.convert_extern` / `extern.convert_any`, which have no delegate
  // hook of their own and were reachable only through an anyref result.
  const GC_TYPES: [string, string][] = [
    ['anyref param', '(module (func (param anyref)))'],
    ['anyref result', '(module (func (result anyref) (ref.null any)))'],
    ['eqref global', '(module (global eqref (ref.null none)))'],
    ['i31ref local', '(module (func (local i31ref)))'],
    ['structref table', '(module (table 1 structref))'],
    [
      'any.convert_extern',
      '(module (func (param externref) (result anyref) (any.convert_extern (local.get 0))))',
    ],
    [
      'extern.convert_any',
      '(module (func (param anyref) (result externref) (extern.convert_any (local.get 0))))',
    ],
  ];
  for (const [name, src] of GC_TYPES) {
    it(`gates ${name} on gc`, () => {
      const bin = encode(src);
      assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok, name);
      assertEquals(
        wasmValidate(bin, { features: { ...allFeatures(), gc: false } }).result,
        Result.Error,
        `${name}: accepted with gc off`,
      );
    });
  }

  it('does NOT catch funcref or externref — those are reference types', () => {
    // The rule has to stop exactly at the GC set; funcref and externref are
    // ratified and on by default, and catching them would reject ordinary
    // modules.
    for (
      const src of [
        '(module (func (param funcref)))',
        '(module (func (param externref)))',
        '(module (table 1 funcref))',
        '(module (table 1 externref))',
      ]
    ) {
      assertEquals(
        wasmValidate(encode(src), { features: { ...allFeatures(), gc: false } }).result,
        Result.Ok,
        `gc:false wrongly rejected a reference type:\n${src}`,
      );
    }
  });

  it('gates a concrete (ref $T) on functionReferences', () => {
    const bin = encode('(module (type $t (func)) (func (param (ref null $t))))');
    assertEquals(wasmValidate(bin, { features: allFeatures() }).result, Result.Ok);
    assertEquals(
      wasmValidate(bin, { features: { ...allFeatures(), functionReferences: false } }).result,
      Result.Error,
    );
  });
});

describe('T13.10 — and the ratified set still validates by default', () => {
  it('accepts MVP + the proposals defaultFeatures() enables', () => {
    // The gates must not have turned into a blanket refusal: everything
    // `defaultFeatures()` says is ON has to keep working with no flags at all.
    for (
      const src of [
        '(module (func (export "f") (result i32) (i32.const 1)))',
        '(module (func (result i32) (i32.extend8_s (i32.const 1))))', // signExtension
        '(module (func (result i32) (i32.trunc_sat_f32_s (f32.const 1))))', // satFloatToInt
        '(module (func (result v128) (v128.const i32x4 1 2 3 4)))', // simd
        '(module (table 1 externref))', // referenceTypes
        '(module (memory 1) (data $d "x") (func (memory.init $d (i32.const 0) (i32.const 0) (i32.const 0))))', // bulkMemory
        '(module (func (result i32 i32) (i32.const 1) (i32.const 2)))', // multiValue
        '(module (import "m" "g" (global (mut i32))))', // mutableGlobals
      ]
    ) {
      const v = wasmValidate(encode(src), { features: defaultFeatures() });
      assertEquals(
        v.result,
        Result.Ok,
        `default features rejected:\n${src}\n${formatErrors(v.errors)}`,
      );
    }
  });

  it('gates an explicitly-disabled ratified proposal too', () => {
    // Turning a default-ON proposal off must also work — the flag is a switch,
    // not a description of the default.
    const bin = encode('(module (memory 1) (memory 1))');
    assertEquals(
      wasmValidate(bin, { features: { ...allFeatures(), multiMemory: false } }).result,
      Result.Error,
    );
  });
});
