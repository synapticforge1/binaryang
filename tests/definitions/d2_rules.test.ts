// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// D2's `typeRules` and `encodingRules` say what binaryang's validator does
// (open-work 42; the type rule is wasm-tools 1.262's, owner 2026-10-24). Both
// runtimes take their meaning of `--features` from these rules (contract v33),
// so each rule is PROVED here on a module that uses only it:
//
// - valid with every feature on (`needs: null` — refused even then);
// - each group of `needs` switched off entirely: refused;
// - in a group of alternatives, any ONE switched off alone: still valid.
//
// A rule with no sample module fails, so a new rule cannot arrive unproved.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { FEATURE_DEFINITIONS } from '../../src/definitions/mod.ts';
import type { FeatureNeeds } from '../../src/definitions/mod.ts';
import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import type { Features } from '../../src/core/feature.ts';
import { Result } from '../../src/core/result.ts';

const leb = (n: number): number[] => {
  const o: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    o.push(b);
  } while (n !== 0);
  return o;
};
const sec = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const wat = (src: string) => wat2wasm(src, { textForm: false, features: allFeatures() }).binary!;

/** One module per rule, using that rule and nothing else gated. */
/** A rule that names several forms gets one sample per form, each proved alike. */
const SAMPLES: Record<string, Uint8Array | Uint8Array[]> = {
  'funcref, externref — (ref null func), (ref null extern)': wat(
    '(module (func (param externref)))',
  ),
  '(ref func), (ref extern) — non-null': wat('(module (func (param (ref extern))))'),
  '(ref $t), (ref null $t) — a type index': wat(
    '(module (type $t (func)) (func (param (ref $t))))',
  ),
  'exnref, nullexnref — (ref null? exn), (ref null? noexn)': wat('(module (func (param exnref)))'),
  'anyref, eqref, i31ref, structref, arrayref, nullref, nullfuncref, nullexternref — and (ref null? any | eq | i31 | struct | array | none | nofunc | noextern)':
    wat('(module (func (param (ref any))))'),
  // A function type taking a stringref (0x67): no text form, so the bytes.
  'stringref': new Uint8Array([...MAGIC, ...sec(1, [1, 0x60, 1, 0x67, 0])]),
  'importing or exporting a mutable global': [
    wat('(module (global (export "g") (mut i32) (i32.const 0)))'),
    wat('(module (import "m" "g" (global (mut i32))))'),
  ],
  // call_indirect (type 0) with the table index as the LEB `80 00`.
  'a call_indirect table index in more than one byte (an LEB other than the single byte 0x00)':
    new Uint8Array([
      ...MAGIC,
      ...sec(1, [1, 0x60, 0, 0]),
      ...sec(3, [1, 0]),
      ...sec(4, [1, 0x70, 0, 1]),
      ...sec(10, [1, 8, 0, 0x41, 0, 0x11, 0, 0x80, 0x00, 0x0b]),
    ]),
  'more than one table': wat('(module (table 1 funcref) (table 1 funcref))'),
  'a table initializer expression': wat(
    '(module (type $t (func)) (func $f) (elem declare func $f) (table 1 funcref (ref.func $f)))',
  ),
  'a function type with more than one result; a block, loop or if with parameters': [
    wat('(module (func (result i32 i32) (i32.const 1) (i32.const 2)))'),
    wat('(module (func (i32.const 1) (block (param i32) drop)))'),
  ],
  'more than one memory': wat('(module (memory 1) (memory 1))'),
  'a shared memory': wat('(module (memory 1 1 shared))'),
  'a 64-bit memory or table': [
    wat('(module (memory i64 1))'),
    wat('(module (table i64 1 funcref))'),
  ],
  'a custom page size': wat('(module (memory 1 (pagesize 1)))'),
  'a struct or array type definition': wat('(module (type (struct)))'),
  'a tag (the tag section, imported or exported)': wat('(module (tag))'),
};

const valid = (bytes: Uint8Array, off: string[]) => {
  const f = { ...allFeatures() } as Record<string, boolean>;
  for (const k of off) f[k] = false;
  return wasmValidate(bytes, { features: f as unknown as Features }).result === Result.Ok;
};

function prove(rule: string, needs: FeatureNeeds) {
  const given = SAMPLES[rule];
  it(`${rule}: has a sample module`, () => expect(given).toBeDefined());
  if (given === undefined) return;
  const samples = Array.isArray(given) ? given : [given];
  for (const [i, bytes] of samples.entries()) {
    const name = samples.length > 1 ? `${rule} [form ${i + 1}]` : rule;
    if (needs === null) {
      it(`${name}: refused even with every feature on`, () => expect(valid(bytes, [])).toBe(false));
      continue;
    }
    it(`${name}: valid with every feature on`, () => expect(valid(bytes, [])).toBe(true));
    for (const group of needs) {
      it(`${name}: refused with ${group.join(' and ')} off`, () => {
        expect(valid(bytes, group)).toBe(false);
      });
      if (group.length > 1) {
        for (const one of group) {
          it(`${name}: still valid with only ${one} off (an alternative remains)`, () => {
            expect(valid(bytes, [one])).toBe(true);
          });
        }
      }
    }
  }
}

describe("D2's typeRules are the validator's", () => {
  for (const r of FEATURE_DEFINITIONS.typeRules) prove(r.type, r.needs);
});

describe("D2's encodingRules are the validator's", () => {
  for (const r of FEATURE_DEFINITIONS.encodingRules) prove(r.encoding, r.needs);
});

describe('the rules name D2 features, and every sample belongs to a rule', () => {
  const names = new Set(FEATURE_DEFINITIONS.entries.map((e) => e.name));
  it('every feature a rule needs is a D2 feature', () => {
    for (
      const r of [...FEATURE_DEFINITIONS.typeRules, ...FEATURE_DEFINITIONS.encodingRules]
    ) {
      for (const g of r.needs ?? []) {
        for (const f of g) expect(`${f}: ${names.has(f)}`).toBe(`${f}: true`);
      }
    }
  });
  it('no sample without a rule', () => {
    const rules = new Set([
      ...FEATURE_DEFINITIONS.typeRules.map((r) => r.type),
      ...FEATURE_DEFINITIONS.encodingRules.map((r) => r.encoding),
    ]);
    expect(Object.keys(SAMPLES).filter((k) => !rules.has(k))).toEqual([]);
  });
});
