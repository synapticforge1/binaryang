// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// D1 against the WebAssembly specification (open-work 34): every D1 opcode is
// defined by a specification source under the same name, and every opcode a
// source defines is in D1, except the known differences, each with its reason.
// The facts are the committed snapshot `bun scripts/spec-opcodes.ts refresh`
// extracted from the sources; this reads only the snapshot, so CI needs no
// checkout. Each way the check can fail is exercised below on a mutated D1.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import { OPCODE_DEFINITIONS } from '../../src/definitions/mod.ts';
import { compareWithSpec, SNAPSHOT } from '../../scripts/spec-opcodes.ts';
import type { SpecSnapshot } from '../../scripts/spec-opcodes.ts';

const SNAP = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as SpecSnapshot;
const D1 = OPCODE_DEFINITIONS.entries.map((e) => ({
  name: e.name,
  prefix: e.prefix,
  opcode: e.opcode,
}));

describe('D1 against the specification snapshot', () => {
  it('agrees: every opcode both ways, names equal or a known difference', () => {
    expect(compareWithSpec(D1, SNAP)).toEqual([]);
  });

  it('records where each fact came from: repository, full commit, files, licence', () => {
    expect(SNAP.sources.length).toBeGreaterThan(0);
    for (const s of SNAP.sources) {
      expect(s.repository).toMatch(/^https:\/\/github\.com\/WebAssembly\//);
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(s.files.length).toBeGreaterThan(0);
      expect(s.licence).not.toBe('');
    }
    const names = new Set(SNAP.sources.map((s) => s.name));
    for (const o of SNAP.opcodes) expect(names.has(o.source)).toBe(true);
  });

  it('every known difference is still a difference, with a reason', () => {
    for (const k of SNAP.known) {
      expect(k.reason).not.toBe('');
      expect(
        SNAP.opcodes.some((o) =>
          o.prefix === k.prefix && o.opcode === k.opcode && o.name === k.spec
        ),
      ).toBe(true);
      expect(D1.some((e) => e.prefix === k.prefix && e.opcode === k.opcode && e.name === k.d1))
        .toBe(true);
    }
  });

  describe('fails on a D1 that disagrees', () => {
    const at = (name: string) => D1.findIndex((e) => e.name === name);
    const mutate = (i: number, change: Partial<(typeof D1)[number]>) =>
      D1.map((e, j) => (j === i ? { ...e, ...change } : e));

    it('a renamed opcode', () => {
      const p = compareWithSpec(mutate(at('i32.add'), { name: 'i32.plus' }), SNAP);
      expect(p).toHaveLength(1);
      expect(p[0]).toContain('i32.plus');
    });
    it('a renumbered opcode (one missing, one undefined)', () => {
      expect(compareWithSpec(mutate(at('i32.add'), { opcode: 0xff }), SNAP)).toHaveLength(2);
    });
    it('a wrong prefix', () => {
      expect(compareWithSpec(mutate(at('i32.atomic.load'), { prefix: '0xfc' }), SNAP).length)
        .toBeGreaterThan(0);
    });
    it('a dropped opcode, from any source', () => {
      for (const name of ['i32.add', 'memory.atomic.notify', 'i64.add128', 'delegate', 'throw']) {
        const p = compareWithSpec(D1.filter((e) => e.name !== name), SNAP);
        expect(p).toHaveLength(1);
        expect(p[0]).toContain('not in D1');
      }
    });
    it('an opcode no source defines', () => {
      const p = compareWithSpec([...D1, { name: 'i32.extra', prefix: '0xfe', opcode: 0x7f }], SNAP);
      expect(p).toEqual([expect.stringContaining('no source defines')]);
    });
    it('a known difference holds only for its own pair of names', () => {
      const i = at('i32x4.relaxed_trunc_f64x2_s_zero');
      expect(compareWithSpec(mutate(i, { name: 'i32x4.relaxed_trunc_f64x2_s' }), SNAP)).toEqual([]);
      expect(compareWithSpec(mutate(i, { name: 'i32x4.relaxed_trunc_f64x2_s_one' }), SNAP))
        .toHaveLength(1);
      expect(compareWithSpec(D1, { ...SNAP, known: [] })).toHaveLength(2);
    });
    it('the " null" form is allowed only on the name the source gives', () => {
      expect(compareWithSpec(mutate(at('ref.test null'), { name: 'ref.cast null' }), SNAP))
        .toHaveLength(1);
    });
  });
});
