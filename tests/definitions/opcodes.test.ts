// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// D1, the instruction table (open-work 22), proved against binaryang's own
// reader, writer and validator — the `proof` rule the data states:
// - every entry decodes from its encoding and immediates as ONE instruction
//   and re-encodes to the same bytes;
// - every stated signature validates (addr as i32, and as i64 on a memory64
//   memory) and is refused with its first or its last operand changed;
// - every gated instruction with a signature is refused with its feature off.
// Each check was inverted when it was written (a dropped or extra immediate, a
// wrong operand type, a gate removed) — a check that cannot fail proves nothing.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { OPCODE_DEFINITIONS, opcodeKey } from '../../src/definitions/mod.ts';
import type { OpcodeDefinition } from '../../src/definitions/mod.ts';
import {
  GcOpcode,
  MiscOpcode,
  Opcode,
  PREFIX_GC,
  PREFIX_MISC,
} from '../../src/wabt-ts/core/opcode.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../src/wabt-ts/writer/binary-writer.ts';
import { formatErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { wasmValidate } from '../../src/wabt-ts/tools/wasm-validate.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { allFeatures } from '../../src/wabt-ts/core/feature.ts';

const ENTRIES = OPCODE_DEFINITIONS.entries;

const leb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
};
const vec = (items: number[][]) => [...leb(items.length), ...items.flat()];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const opBytes = (d: OpcodeDefinition) => d.encoding.split(' ').map((h) => parseInt(h, 16));

/** A sample of one immediate, valid for the module {@link decodeModule} builds. */
function immediate(kind: string, d: OpcodeDefinition): number[] {
  switch (kind) {
    case 'blocktype':
      return [0x40];
    case 'typeidx':
      // 0: func () -> (); 1: struct (mut i32); 2: array (mut i32).
      return d.prefix === '0xfb' ? [/^array/.test(d.name) ? 0x02 : 0x01] : [0x00];
    case 'vec(labelidx)':
      return [0x01, 0x00];
    case 'vec(valtype)':
      return [0x01, 0x7f];
    case 'vec(catch)':
      return [0x00];
    case 'memarg':
      return [Math.log2(d.align ?? 1), 0x00];
    case 'f32':
      return [0, 0, 0, 0];
    case 'f64':
      return new Array(8).fill(0);
    case 'v128':
    case 'lane16':
      return new Array(16).fill(0);
    case 'heaptype':
      return [0x6e];
    default:
      return [0x00]; // every index, lane, flag and LEB constant: 0
  }
}

/** The instruction alone — or in the structure a marker needs to stand in. */
function decodeBody(d: OpcodeDefinition): number[] {
  const instr = [...opBytes(d), ...d.immediates.flatMap((k) => immediate(k, d))];
  switch (d.name) {
    case 'else':
      return [0x04, 0x40, ...instr, 0x0b];
    case 'end':
      return [0x02, 0x40, ...instr];
    case 'catch':
    case 'catch_all':
      return [0x06, 0x40, ...instr, 0x0b];
    case 'delegate':
      return [0x06, 0x40, ...instr];
  }
  return ['block', 'loop', 'if', 'try', 'try_table'].includes(d.name) ? [...instr, 0x0b] : instr;
}

/** One of every entity an immediate may name, and one function holding `code`. */
function decodeModule(code: number[]): Uint8Array {
  const fn = [...vec([[0x01, 0x7f]]), ...code, 0x0b];
  return new Uint8Array([
    ...MAGIC,
    ...section(1, vec([[0x60, 0x00, 0x00], [0x5f, 0x01, 0x7f, 0x01], [0x5e, 0x7f, 0x01]])),
    ...section(3, vec([[0x00]])),
    ...section(4, vec([[0x70, 0x00, 0x01]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(13, vec([[0x00, 0x00]])),
    ...section(6, vec([[0x7f, 0x01, 0x41, 0x00, 0x0b]])),
    ...section(9, vec([[0x01, 0x00, 0x00]])),
    ...section(12, leb(1)),
    ...section(10, vec([[...leb(fn.length), ...fn]])),
    ...section(11, vec([[0x01, 0x00]])),
  ]);
}

/** The code section's bytes, hex. */
function codeSection(b: Uint8Array): string {
  let i = 8;
  while (i < b.length) {
    const id = b[i]!;
    let size = 0, shift = 0, j = i + 1;
    for (;;) {
      const x = b[j++]!;
      size |= (x & 0x7f) << shift;
      shift += 7;
      if (!(x & 0x80)) break;
    }
    if (id === 10) return [...b.slice(j, j + size)].map((x) => x.toString(16)).join(' ');
    i = j + size;
  }
  return '(none)';
}

const VT: Record<string, number> = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, v128: 0x7b };

/** A function whose params are `params`, results `results`, body: the params, then `d`. */
function signatureModule(
  d: OpcodeDefinition,
  params: string[],
  results: string[],
  mem64: boolean,
  alignExp?: number,
): Uint8Array {
  const shared = d.class === 'atomic';
  const flags = (mem64 ? 0x04 : 0x00) | (shared ? 0x03 : 0x00);
  const code = [
    ...params.flatMap((_, i) => [0x20, ...leb(i)]),
    ...opBytes(d),
    ...d.immediates.flatMap((k) =>
      k === 'memarg' && alignExp !== undefined ? [alignExp, 0x00] : immediate(k, d)
    ),
    0x0b,
  ];
  const fn = [...vec([]), ...code];
  const sig = [0x60, ...vec(params.map((p) => [VT[p]!])), ...vec(results.map((r) => [VT[r]!]))];
  return new Uint8Array([
    ...MAGIC,
    ...section(1, vec([sig])),
    ...section(3, vec([[0x00]])),
    ...section(5, vec([shared ? [flags, 0x01, 0x01] : [flags, 0x01]])),
    ...section(9, vec([[0x01, 0x00, 0x00]])),
    ...section(12, leb(1)),
    ...section(10, vec([[...leb(fn.length), ...fn]])),
    ...section(11, vec([[0x01, 0x00]])),
  ]);
}

const errorsOf = (b: Uint8Array, features: ReturnType<typeof allFeatures>) =>
  wasmValidate(b, { features }).errors.map((e) => e.message);

describe('D1 is the instruction table binaryang uses', () => {
  it('keys are unique, and every enum member has its entry', () => {
    const keys = ENTRIES.map(opcodeKey);
    expect(new Set(keys).size).toBe(keys.length);
    const has = new Set(keys);
    const missing: string[] = [];
    for (const [k, v] of Object.entries(Opcode)) {
      if (typeof v === 'number' && !has.has(v)) missing.push(`Opcode.${k}`);
    }
    for (const [k, v] of Object.entries(MiscOpcode)) {
      if (typeof v === 'number' && !has.has((PREFIX_MISC << 16) | v)) {
        missing.push(`MiscOpcode.${k}`);
      }
    }
    for (const [k, v] of Object.entries(GcOpcode)) {
      if (typeof v === 'number' && !has.has((PREFIX_GC << 16) | v)) missing.push(`GcOpcode.${k}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('every entry decodes as ONE instruction and re-encodes to its bytes', () => {
  it('all of them', () => {
    const bad: string[] = [];
    for (const d of ENTRIES) {
      const bytes = decodeModule(decodeBody(d));
      const errors = makeErrorList();
      const m = readBinaryIr(bytes, errors, { readDebugNames: false });
      if (errors.length > 0) {
        bad.push(`${d.name}: ${formatErrors(errors).split('\n')[0]}`);
        continue;
      }
      // An extra immediate whose sample byte is an opcode decodes as a SECOND instruction.
      if (m.functions[0]!.body.children.length !== 1) {
        bad.push(`${d.name}: ${m.functions[0]!.body.children.length} instructions`);
        continue;
      }
      const out = writeBinaryIr(m, { writeDebugNames: false });
      if (codeSection(out) !== codeSection(bytes)) bad.push(`${d.name}: re-encoded differently`);
    }
    expect(bad).toEqual([]);
  });
});

describe('every stated signature is what the validator checks', () => {
  const all = allFeatures();
  const signed = ENTRIES.filter((d) => d.signature !== null);

  it('valid as stated, refused with the first or the last operand changed', () => {
    const bad: string[] = [];
    for (const d of signed) {
      const sig = d.signature!;
      const memories = [...sig.params, ...sig.results].includes('addr') ? [false, true] : [false];
      for (const mem64 of memories) {
        const at = (t: string) => (t === 'addr' ? (mem64 ? 'i64' : 'i32') : t);
        const params = sig.params.map(at), results = sig.results.map(at);
        const tag = `${d.name}${mem64 ? ' (memory64)' : ''}`;
        const errs = errorsOf(signatureModule(d, params, results, mem64), all);
        if (errs.length > 0) {
          bad.push(`${tag}: invalid as stated — ${errs[0]}`);
          continue;
        }
        for (const at of new Set([0, params.length - 1])) {
          if (params.length === 0) break;
          const wrong = [...params];
          wrong[at] = wrong[at] === 'i32' ? 'f64' : 'i32';
          if (errorsOf(signatureModule(d, wrong, results, mem64), all).length === 0) {
            bad.push(`${tag}: valid with operand ${at} as ${wrong[at]}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('align is EXACTLY the natural alignment: one step above it is refused', () => {
    // An alignment below natural is valid, so only the step above proves the
    // stated width is not too small.
    const bad: string[] = [];
    for (const d of signed.filter((x) => x.align !== undefined)) {
      const sig = d.signature!;
      const at = (t: string) => (t === 'addr' ? 'i32' : t);
      const over = Math.log2(d.align!) + 1;
      const bytes = signatureModule(d, sig.params.map(at), sig.results.map(at), false, over);
      if (errorsOf(bytes, all).length === 0) bad.push(`${d.name}: align 2^${over} accepted`);
    }
    expect(bad).toEqual([]);
  });

  it('refused with its feature off', () => {
    const bad: string[] = [];
    for (const d of signed.filter((x) => x.feature !== null)) {
      const sig = d.signature!;
      const at = (t: string) => (t === 'addr' ? 'i32' : t);
      const bytes = signatureModule(d, sig.params.map(at), sig.results.map(at), false);
      if (errorsOf(bytes, { ...all, [d.feature!]: false }).length === 0) {
        bad.push(`${d.name}: valid with ${d.feature} off`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('🔧 the feature gate D1 drives (open-work 22)', () => {
  const refused = (wat: string, feature: string) => {
    const bytes = wat2wasm(wat, { textForm: false, validate: false }).binary;
    expect(errorsOf(bytes, allFeatures())).toEqual([]);
    const errs = errorsOf(bytes, { ...allFeatures(), [feature]: false });
    expect(errs.join('\n')).toMatch(new RegExp(`enable the ${feature} feature`));
  };

  it('reference-types instructions D1 gives no signature', () => {
    refused(
      `(module (table 1 funcref) (func (drop (table.get 0 (i32.const 0)))))`,
      'referenceTypes',
    );
    refused(`(module (func (drop (ref.null func))))`, 'referenceTypes');
    refused(
      `(module (func (param i32) (drop (select (result i32) (local.get 0) (local.get 0) (local.get 0)))))`,
      'referenceTypes',
    );
  });

  it('the default-on features: SIMD, sign extension, saturating conversion, bulk memory', () => {
    refused(`(module (func (drop (v128.const i64x2 0 0))))`, 'simd');
    refused(`(module (func (drop (i32.extend8_s (i32.const 1)))))`, 'signExtension');
    refused(`(module (func (drop (i32.trunc_sat_f32_s (f32.const 1)))))`, 'satFloatToInt');
    refused(
      `(module (memory 1) (func (memory.copy (i32.const 0) (i32.const 0) (i32.const 0))))`,
      'bulkMemory',
    );
  });
});
