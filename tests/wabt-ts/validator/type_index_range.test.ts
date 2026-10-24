// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 42 (2026-10-24): a reference type an INSTRUCTION names must name a
// type that exists. `ref.test`, `ref.cast` and `br_on_cast` checked nothing,
// so `ref.cast (ref 45)` in a module with two types validated — wasmrt's
// differential fuzz (a one-byte mutation of a `wasm-tools smith` module;
// wasm-tools: "unknown type 45: type index out of bounds"). The bytes below
// are a minimal reconstruction, not wasmrt's inputs. Text cannot express the
// out-of-range index (the parser refuses it), hence the bytes.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors } from '../../../src/core/error.ts';

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const TYPES = [0x01, 0x06, 0x02, 0x5f, 0x00, 0x60, 0x00, 0x00]; // (struct), (func)
const FUNCS = [0x03, 0x02, 0x01, 0x01]; // one function of type 1
const BODY_HEAD = [0x0a, 0x0a, 0x01, 0x08, 0x00, 0xd0, 0x71, 0xfb]; // one body: ref.null none, 0xfb
/** One function: `ref.null none`, the GC instruction `op` naming type `index`, `drop`. */
const code = (op: number, index: number) => [...BODY_HEAD, op, index, 0x1a, 0x0b];
const module = (op: number, index: number) =>
  new Uint8Array([...MAGIC, ...TYPES, ...FUNCS, ...code(op, index)]);
const validate = (bytes: Uint8Array) => {
  const v = wasmValidate(bytes, { features: allFeatures() });
  return { ok: v.result === Result.Ok, text: formatErrors(v.errors) };
};

for (const [name, op] of [['ref.cast', 0x17], ['ref.test', 0x15]] as const) {
  describe(`${name} (ref null $t)`, () => {
    it('valid naming type 0, the struct', () => {
      expect(validate(module(op, 0))).toEqual({ ok: true, text: '' });
    });
    it('refused naming type 45, which does not exist, saying so', () => {
      const v = validate(module(op, 45));
      expect(v.ok).toBe(false);
      expect(v.text).toContain(`unknown type 45 in ${name}`);
    });
  });
}
