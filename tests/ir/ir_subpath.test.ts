// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 21, phase 4: `./ir` replaced `./ir/wabt-ts`, `./ir/binaryen-ts` and `./core/wabt-ts`,
// deprecated in 1.11.0 and REMOVED after it (open-work 25, 2026-10-13). Their files stay, as the
// internal barrels `./ir` is built from. What is pinned: the three are no longer published; `./ir`
// exports every name the three barrels export — types included, read from `deno doc` — from the
// same declaration, with no exception now that binaryen-ts's deprecated `Type` alias is gone;
// every runtime value is the IDENTICAL object; and `Type` in `./ir` is core's enum, the node-type
// union being `ExprType`.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as ir from '../../src/ir/index.ts';
import * as binaryenView from '../../src/ir/binaryen-ts.ts';
import * as wabtView from '../../src/ir/wabt-ts.ts';
import * as core from '../../src/core/index.ts';
import { Type as CoreType } from '../../src/core/types.ts';
import type { ExprType, Type as IrType } from '../../src/ir/index.ts';

const BARRELS = {
  'src/ir/binaryen-ts.ts': '../../src/ir/binaryen-ts.ts',
  'src/ir/wabt-ts.ts': '../../src/ir/wabt-ts.ts',
  'src/core/index.ts': '../../src/core/index.ts',
} as const;

/** Every exported name of an entry file, types included, and where each is declared. */
function exported(entry: string): Map<string, string> {
  const path = new URL(entry, import.meta.url);
  // `deno doc` lists a module's exports, types included, as JSR sees them: a JSR question, so
  // Deno answers it (owner, 2026-10-12: Deno for JSR) whichever runtime runs the tests.
  const out = spawnSync('deno', ['doc', '--json', path.href], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  if (out.status !== 0) throw new Error(out.stderr || String(out.error));
  const doc = JSON.parse(out.stdout) as {
    nodes: Record<string, {
      symbols: { name: string; declarations: { location: { filename: string; line: number } }[] }[];
    }>;
  };
  const symbols = Object.values(doc.nodes)[0]!.symbols;
  return new Map(symbols.map((s) => {
    const l = s.declarations[0]!.location;
    return [s.name, `${l.filename.replace(/^.*\/src\//, 'src/')}:${l.line}`];
  }));
}

describe('./ir — the one subpath for the IR', () => {
  it('is published, and the three subpaths it replaced are not', () => {
    const jsr = JSON.parse(readFileSync(new URL('../../jsr.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(jsr.exports['./ir']).toBe('./src/ir/index.ts');
    for (const gone of ['./ir/binaryen-ts', './ir/wabt-ts', './core/wabt-ts']) {
      expect([gone, gone in jsr.exports]).toEqual([gone, false]);
    }
  });

  it('exports every name of the three barrels it is built from, from the same declaration', () => {
    const all = exported('../../src/ir/index.ts');
    const missing: string[] = [];
    const moved: string[] = [];
    for (const [barrel, path] of Object.entries(BARRELS)) {
      for (const [name, where] of exported(path)) {
        if (!all.has(name)) missing.push(`${barrel}: ${name}`);
        else if (all.get(name) !== where) {
          moved.push(`${barrel}: ${name} (${where} -> ${all.get(name)})`);
        }
      }
    }
    expect(missing).toEqual([]);
    // No exception any more: binaryen-ts's deprecated `Type` alias of `ExprType` was the one.
    expect(moved).toEqual([]);
    expect(all.has('ExprType')).toBe(true);
  });

  it('gives every runtime value of the three barrels as the identical object', () => {
    const irValues = ir as Record<string, unknown>;
    for (const view of [binaryenView, wabtView, core] as Record<string, unknown>[]) {
      for (const [name, value] of Object.entries(view)) {
        expect([name, irValues[name] === value]).toEqual([name, true]);
      }
    }
  });

  it("`Type` is core's enum, and the node-type union is `ExprType`", () => {
    expect(ir.Type).toBe(CoreType);
    expect(ir.Type.I32).toBe(CoreType.I32);
    // Compile-time: each line compiles only if the claim holds.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const enumType: Same<IrType, CoreType> = true;
    const differ: Same<IrType, ExprType> = false;
    expect([enumType, differ]).toEqual([true, false]);
  });
});
