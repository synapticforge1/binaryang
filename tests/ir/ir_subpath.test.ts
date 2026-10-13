// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 21, phase 4: `./ir` replaces `./ir/wabt-ts`, `./ir/binaryen-ts` and
// `./core/wabt-ts` (deprecated for one release). The claim is that a caller
// can switch every import to `./ir` and lose nothing: every name the three
// export — types included, read from `deno doc` — is exported by `./ir`, every
// runtime value is the IDENTICAL object, and the one name whose meaning
// differs is `Type` (core's enum in `./ir`; binaryen-ts's union is `ExprType`).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawnSync } from 'node:child_process';
import * as ir from '../../src/ir/index.ts';
import * as binaryenView from '../../src/ir/binaryen-ts.ts';
import * as wabtView from '../../src/ir/wabt-ts.ts';
import * as core from '../../src/core/index.ts';
import { Type as CoreType } from '../../src/core/types.ts';
import type { ExprType, Type as IrType } from '../../src/ir/index.ts';
import type { Type as DeprecatedBType } from '../../src/ir/binaryen-ts.ts';

const ENTRIES = {
  './ir': '../../src/ir/index.ts',
  './ir/binaryen-ts': '../../src/ir/binaryen-ts.ts',
  './ir/wabt-ts': '../../src/ir/wabt-ts.ts',
  './core/wabt-ts': '../../src/core/index.ts',
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

describe('./ir — one subpath for the IR', () => {
  it(
    'exports every name the three deprecated subpaths export, from the same declaration',
    () => {
      const all = exported(ENTRIES['./ir']);
      const missing: string[] = [];
      const moved: string[] = [];
      for (const old of ['./ir/binaryen-ts', './ir/wabt-ts', './core/wabt-ts'] as const) {
        for (const [name, where] of exported(ENTRIES[old])) {
          if (!all.has(name)) missing.push(`${old}: ${name}`);
          else if (all.get(name) !== where) {
            moved.push(
              `${old}: ${name} (${where} -> ${all.get(name)})`,
            );
          }
        }
      }
      expect(missing).toEqual([]);
      // The ONE name whose declaration differs: binaryen-ts's deprecated `Type` alias
      // of `ExprType`, where `./ir` has core's enum.
      expect(moved).toHaveLength(1);
      // (`deno doc` places an alias re-export at its `export type { … as Type }` line.)
      expect(moved[0]).toMatch(
        /^\.\/ir\/binaryen-ts: Type \(src\/ir\/binaryen-ts\.ts:\d+ -> src\/core\/types\.ts:\d+\)$/,
      );
      expect(all.has('ExprType')).toBe(true);
    },
  );

  it('gives every runtime value of the three as the identical object', () => {
    const irValues = ir as Record<string, unknown>;
    for (const view of [binaryenView, wabtView, core] as Record<string, unknown>[]) {
      for (const [name, value] of Object.entries(view)) {
        expect([name, irValues[name] === value]).toEqual([name, true]);
      }
    }
  });

  it("`Type` is core's enum, and binaryen-ts's union is `ExprType`", () => {
    expect(ir.Type).toBe(CoreType);
    expect(ir.Type.I32).toBe(CoreType.I32);
    // Compile-time: each line compiles only if the claim holds.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const enumType: Same<IrType, CoreType> = true;
    const union: Same<ExprType, DeprecatedBType> = true;
    const differ: Same<IrType, ExprType> = false;
    expect([enumType, union, differ]).toEqual([true, true, false]);
  });
});
