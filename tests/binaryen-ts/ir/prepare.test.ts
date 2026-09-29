// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// M8e (cmem/ir-convergence.md, item 6 M8): `prepareForPasses` — a text-read
// tree made ready for binaryen-ts in place (names M8c, types M8d) — replaced the
// bridge, which rebuilt the module into binaryen-ts's IR. This holds the bridge's
// own test inputs to the direct path.
//
// `fixtures/direct_path_modules.json` is every VALID module the 16 deleted
// `tests/bridge/*` files built (each tagged with the file it came from), plus
// `br_on_cast.test.ts`'s four and a `br` to an `if` — which the bridge refused.
// Each must:
//
// - encode, unoptimized, BYTE-IDENTICAL to `wat2wasm` (the bridge matched it on
//   none of the corpus's 421 modules, and was held only to "V8 accepts it");
// - optimize at -O3 to a module V8 accepts;
// - and, where it instantiates, return from every exported function what the
//   `wat2wasm` module returns, at each sampled argument — the bridge tests ran
//   these, so the direct path's OPTIMIZED output is run too.
//
// ⚠️ The fixture is also an input to `deno task direct` and `deno task
// direct-behaviour` (`scripts/direct-inputs.ts`, post-M8 fix 7): its start
// module is the only one either gate sees. Removing a module removes it from
// both gates too.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { prepareForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';

const FIXTURE = new URL('./fixtures/direct_path_modules.json', import.meta.url);
const MODULES: { from: string; wat: string }[] = JSON.parse(Deno.readTextFileSync(FIXTURE));

/** The direct path: `wat2wasm`'s front end, then `prepareForPasses`. */
function prepared(wat: string) {
  const { module } = parseWatModule(wat);
  resolveNames(module);
  synthesizeTypes(module);
  return prepareForPasses(module);
}

/** Every exported function's result at three sampled arguments — `trap` where it traps. */
function results(bytes: Uint8Array): string {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {});
  const out: string[] = [];
  for (const [name, v] of Object.entries(inst.exports)) {
    if (typeof v !== 'function') continue;
    for (const a of [0, 1, 7]) {
      let r: string;
      try {
        const x = (v as (...args: number[]) => unknown)(a, a);
        r = typeof x === 'bigint' ? `${x}n` : Number.isNaN(x) ? 'nan' : String(x);
      } catch (e) {
        r = e instanceof WebAssembly.RuntimeError ? 'trap' : `throw ${(e as Error).name}`;
      }
      out.push(`${name}(${a})=${r}`);
    }
  }
  return out.join('; ');
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe("M8e — the bridge's test modules, on the direct path", () => {
  it('the fixture is what it says: 123 valid modules from 16 files', () => {
    assertEquals(MODULES.length, 123);
    assertEquals(new Set(MODULES.map((m) => m.from.split(' ')[0])).size, 16);
  });

  it('prepares in place: the same module, named and typed', () => {
    const { module } = parseWatModule('(module (func (result i32) (i32.const 1)))');
    resolveNames(module);
    synthesizeTypes(module);
    assert(prepareForPasses(module) === module, 'in place');
    assertEquals(module.functions[0]!.name, '$func0');
    assertEquals(module.functions[0]!.body.children[0]!.type, 0x7f);
  });

  for (const [i, { from, wat }] of MODULES.entries()) {
    it(`#${i} (${from}): wat2wasm's bytes; valid and the same results at -O3`, () => {
      const expected = wat2wasm(wat).binary;
      assert(same(writeWasm(prepared(wat)), expected), 'byte-identical to wat2wasm');

      const m = prepared(wat);
      new PassRunner(m, { optimizeLevel: 3, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
      const optimized = writeWasm(m);
      assert(WebAssembly.validate(optimized as BufferSource), 'V8 accepts the -O3 output');

      let want: string;
      try {
        want = results(expected);
      } catch {
        return; // imports it needs: validated, not run
      }
      assertEquals(results(optimized), want);
    });
  }
});
