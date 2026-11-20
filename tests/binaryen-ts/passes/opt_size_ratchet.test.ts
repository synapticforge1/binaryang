/**
 * `scripts/opt-size.ts` `judge`: the wasm-opt size ratchet (review C-R2-2). Growth past the
 * baseline fails; a gain fails too until it is recorded, so it cannot be given back unseen.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { judge, type SizeEntry } from '../../../scripts/opt-size.ts';

const base: SizeEntry = { ours: 1010, binaryen: 1000, modules: 3, refused: ['x'] };
const run = (now: SizeEntry) => {
  const fails: string[] = [];
  const notes: string[] = [];
  judge('set', now, base, fails, notes);
  return { fails, notes };
};

describe('size ratchet judge', () => {
  it('passes at the baseline ratio', () => {
    expect(run({ ...base, ours: 2020, binaryen: 2000 }).fails).toEqual([]);
  });
  it('fails when binaryang grows past the ratio', () => {
    const { fails } = run({ ...base, ours: 1011 });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('GREW');
  });
  it('fails on a gain until it is recorded, naming the command', () => {
    const { fails } = run({ ...base, ours: 1009 });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('SMALLER');
    expect(fails[0]).toContain('--update-baseline');
  });
  it('fails when binaryen refuses a different set of modules', () => {
    expect(run({ ...base, refused: [] }).fails).toHaveLength(1);
  });
  it('fails with no baseline entry', () => {
    const fails: string[] = [];
    judge('set', base, undefined, fails, []);
    expect(fails[0]).toContain('no baseline entry');
  });
});
