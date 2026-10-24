// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 40 (2026-10-24; wasmrt's item 4, binding on wasmrt and wazmrt since
// contract v33): which feature a module needs follows D1 and D2.
//
// - `return_call_ref` needs functionReferences ONLY. The function-references
//   proposal defines it (opcode 0x15); upstream wabt 1.0.41, wasm-tools 1.262
//   and wasmtime 50 accept it with tail-call off. binaryang also demanded
//   tailCall — inherited from wabt-ts (1.8.1 already did) — and D1 said so.
// - D2's `requires` is RECORDED, NOT ENFORCED (owner, 2026-10-24): each
//   instruction is gated by its own feature, so with gc on and
//   functionReferences off a GC struct is accepted and `call_ref` is refused —
//   wasmtime 50's and wasm-tools 1.262's answers, measured the same day.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import type { Features } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors } from '../../../src/core/error.ts';
import { FEATURE_DEFINITIONS, OPCODE_DEFINITIONS } from '../../../src/definitions/mod.ts';

const SIG = '(type $t (func (result i32))) (func $f (type $t) i32.const 1) (elem declare func $f)';
const RETURN_CALL_REF = `(module ${SIG} (func (result i32) (return_call_ref $t (ref.func $f))))`;
const CALL_REF = `(module ${SIG} (func (result i32) (call_ref $t (ref.func $f))))`;
const RETURN_CALL =
  '(module (func $g (result i32) i32.const 1) (func (result i32) (return_call $g)))';
const GC_STRUCT =
  '(module (type $s (struct (field i32))) (func (result i32) (struct.get $s 0 (struct.new $s (i32.const 1)))))';

const bin = (src: string) => wat2wasm(src, { textForm: false, features: allFeatures() }).binary!;
const validate = (src: string, off: Partial<Features>) => {
  const v = wasmValidate(bin(src), { features: { ...allFeatures(), ...off } });
  return { ok: v.result === Result.Ok, text: formatErrors(v.errors) };
};

describe('return_call_ref is gated by functionReferences, not tailCall', () => {
  it('D1 says functionReferences', () => {
    expect(OPCODE_DEFINITIONS.entries.find((e) => e.name === 'return_call_ref')!.feature).toBe(
      'functionReferences',
    );
  });
  it('valid with every feature on, and with tailCall off', () => {
    expect(validate(RETURN_CALL_REF, {}).ok).toBe(true);
    expect(validate(RETURN_CALL_REF, { tailCall: false })).toEqual({ ok: true, text: '' });
  });
  it('refused with functionReferences off, naming it', () => {
    const v = validate(RETURN_CALL_REF, { functionReferences: false });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('functionReferences');
  });
  it('the other tail calls still need tailCall', () => {
    expect(validate(RETURN_CALL, {}).ok).toBe(true);
    const v = validate(RETURN_CALL, { tailCall: false });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('tailCall');
  });
});

describe("D2's requires is recorded, not enforced", () => {
  it('D2 records gc as requiring functionReferences', () => {
    expect(FEATURE_DEFINITIONS.entries.find((e) => e.name === 'gc')!.requires).toContain(
      'functionReferences',
    );
  });
  it('gc on, functionReferences off: a GC struct is accepted', () => {
    expect(validate(GC_STRUCT, { functionReferences: false })).toEqual({ ok: true, text: '' });
  });
  it('gc on, functionReferences off: call_ref is refused (gc does not imply it)', () => {
    const v = validate(CALL_REF, { functionReferences: false });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('functionReferences');
  });
});
