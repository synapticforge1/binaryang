/**
 * The compatibility gate's floor (workspace letter H6; `scripts/release/api-surface.ts`): which bump
 * a surface difference demands. Pure: two hand-made surfaces, no `deno doc`, no git. Each rule is
 * also checked from the other side — the inversion the workspace rules ask of a gate.
 */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { flagsIn, floorOf, type Surface, usageText } from '../../../scripts/release/api-surface.ts';

const base = (): Surface => ({
  library: {
    './ir': {
      makeNop: 'function#aaaaaaaaaaaa',
      Expr: 'interface#bbbbbbbbbbbb',
      'Expr.kind': 'property#cccccccccccc',
    },
  },
  cli: { wat2wasm: { flags: ['--enable-all', '-o'], usage: '111111111111' } },
  passes: ['DeadCodeElimination', 'Vacuum'],
});

describe('floorOf: what a surface difference demands', () => {
  it('nothing changed is a patch, with no reasons', () => {
    expect(floorOf(base(), base())).toEqual({ floor: 'patch', reasons: [] });
  });

  it('an added symbol, member, export, flag or pass is a minor', () => {
    const cases: ((s: Surface) => void)[] = [
      (s) => (s.library['./ir']!['makeDrop'] = 'function#dddddddddddd'),
      (s) => (s.library['./ir']!['Expr.loc'] = 'property#eeeeeeeeeeee'),
      (s) => (s.library['./ts2wasm'] = {}),
      (s) => s.cli['wat2wasm']!.flags.push('--no-check'),
      (s) => s.passes.push('MergeLocals'),
    ];
    for (const add of cases) {
      const after = base();
      add(after);
      expect(floorOf(base(), after).floor).toBe('minor');
    }
  });

  it('a removed or changed symbol, member, export, flag, pass or tool is a major', () => {
    const cases: ((s: Surface) => void)[] = [
      (s) => delete s.library['./ir']!['makeNop'],
      (s) => delete s.library['./ir']!['Expr.kind'],
      (s) => (s.library['./ir']!['makeNop'] = 'function#ffffffffffff'),
      (s) => delete s.library['./ir'],
      (s) => s.cli['wat2wasm']!.flags.splice(0, 1),
      (s) => delete s.cli['wat2wasm'],
      (s) => s.passes.splice(0, 1),
    ];
    for (const change of cases) {
      const after = base();
      change(after);
      expect(floorOf(base(), after).floor).toBe('major');
    }
  });

  it('a usage text reworded, flags unchanged, is a patch that is still reported', () => {
    const after = base();
    after.cli['wat2wasm']!.usage = '222222222222';
    const f = floorOf(base(), after);
    expect(f.floor).toBe('patch');
    expect(f.reasons).toEqual([{ level: 'patch', what: 'CLI wat2wasm: usage text changed' }]);
  });

  it("a bump alone is no usage change: the tree's own version is not part of the text", () => {
    // 1.16.0's bump failed surface:check on CI: the root usage names the version.
    const before = usageText('binaryang 1.15.0 — a toolchain\r\n  wasm-opt  optimise\n', '1.15.0');
    expect(before).toBe('binaryang <version> — a toolchain\n  wasm-opt  optimise');
    expect(usageText('binaryang 1.16.0 — a toolchain\n  wasm-opt  optimise', '1.16.0')).toBe(
      before,
    );
    // A real wording change still differs.
    expect(usageText('binaryang 1.16.0 — a tool chain\n  wasm-opt  optimise', '1.16.0')).not.toBe(
      before,
    );
  });

  it("a template's stem is not a flag: --enable-<feature> names no flag --enable-", () => {
    expect(flagsIn('usage: t [--enable-<feature>|--disable-<feature>] -o <f> --enable-gc'))
      .toEqual(['--enable-gc', '-o']);
  });

  it('the floor is the HIGHEST reason: an addition does not hide a removal', () => {
    const after = base();
    after.library['./ir']!['makeDrop'] = 'function#dddddddddddd';
    delete after.library['./ir']!['makeNop'];
    const f = floorOf(base(), after);
    expect(f.floor).toBe('major');
    expect(f.reasons.map((r) => r.level).sort()).toEqual(['major', 'minor']);
  });
});
