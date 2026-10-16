// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// RemoveUnusedModuleElements, open-work 30 step 3: a function only a table this module alone can
// see holds, that no `call_indirect` of its signature can reach, keeps its slot but its body traps,
// and what only it called goes. Each case RUNS every slot of the table before and after the pass
// (through `call_indirect` of each signature, or from JS where the table is visible) and asserts
// whether a body was emptied.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { PassRunner } from '../../../src/passes/index.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../../src/core/feature.ts';

type Fn = (...a: unknown[]) => unknown;

function rume(wat: string) {
  const before = wat2wasm(wat, { textForm: false, features: allFeatures() }).binary;
  const m = readForPasses(before);
  new PassRunner(m, {}).add('RemoveUnusedModuleElements').run();
  // `locals` is every local, the parameters first: an emptied function keeps its parameters'.
  for (const f of m.functions) expect(f.locals.length).toBeGreaterThanOrEqual(f.sig.params.length);
  const out = writeWasm(m);
  expect(wasmValidate(out, { features: allFeatures() }).errors.map((e) => e.message)).toEqual([]);
  return { before, after: out, text: wasm2wat(out).text };
}

/** Each export called with each argument list, before and after: the same result or the same trap. */
async function same(
  before: Uint8Array,
  after: Uint8Array,
  calls: [string, unknown[]][],
  imports: () => WebAssembly.Imports = () => ({}),
) {
  const run = async (b: Uint8Array) => {
    const { instance } = await WebAssembly.instantiate(b as BufferSource, imports());
    const ex = instance.exports as Record<string, unknown>;
    const out: string[] = [];
    for (const [name, args] of calls) {
      try {
        out.push(`${name}(${args}) -> ${String((ex[name] as Fn)(...args))}`);
      } catch (e) {
        out.push(`${name}(${args}) -> ${e instanceof WebAssembly.RuntimeError ? 'trap' : 'threw'}`);
      }
    }
    return out;
  };
  expect(await run(after)).toEqual(await run(before));
}

const count = (text: string, s: string) => text.split(s).length - 1;

/** Slot 0: `$one` (i32) -> i32; slot 1: `$two` (i32 i32) -> (), which alone calls `$helper`. */
const TABLE = (table = '(table $tab 2 2 funcref)', more = '') =>
  `(module
  (type $t1 (func (param i32) (result i32)))
  (type $t2 (func (param i32 i32)))
  ${table}
  (global $g (mut i32) (i32.const 0))
  (elem (table $tab) (i32.const 0) func $one $two)
  (func $one (type $t1) (i32.add (local.get 0) (i32.const 1)))
  (func $two (type $t2) (call $helper (local.get 0)) (call $helper (local.get 1)))
  (func $helper (param i32) (global.set $g (i32.add (global.get $g) (local.get 0))))
  (func (export "call1") (param i32 i32) (result i32)
    (call_indirect $tab (type $t1) (local.get 0) (local.get 1)))
  ${more})`;

describe('a slot no call_indirect can reach keeps its slot, not its body', () => {
  it('only (i32) -> i32 is ever called: $two traps and $helper goes', async () => {
    const { before, after, text } = rume(TABLE());
    expect(count(text, '(func (;')).toBe(3); // $one, $two (emptied), call1; $helper removed
    expect(count(text, 'unreachable')).toBe(1);
    expect(count(text, 'global.set')).toBe(0);
    await same(before, after, [['call1', [5, 0]], ['call1', [5, 1]], ['call1', [5, 2]]]);
  });

  it('a call_indirect of the other signature keeps it', async () => {
    const { before, after, text } = rume(
      TABLE(
        undefined,
        `(func (export "call2") (param i32 i32)
        (call_indirect $tab (type $t2) (local.get 0) (local.get 0) (local.get 1)))`,
      ),
    );
    expect(count(text, 'global.set')).toBe(1);
    await same(before, after, [['call1', [5, 0]], ['call2', [5, 1]], ['call2', [5, 0]]]);
  });
});

describe('not when the table can be seen or changed', () => {
  it('an exported table: JS can call any slot', async () => {
    const { before, after, text } = rume(TABLE('(table $tab (export "tab") 2 2 funcref)'));
    expect(count(text, 'global.set')).toBe(1);
    const viaJs = async (b: Uint8Array) => {
      const { instance } = await WebAssembly.instantiate(b as BufferSource, {});
      const tab = (instance.exports as { tab: WebAssembly.Table }).tab;
      try {
        return String((tab.get(1) as Fn)(3, 4));
      } catch (e) {
        return `${(e as Error).name}`;
      }
    };
    expect(await viaJs(after)).toBe(await viaJs(before));
  });

  it('an imported table: the host can call any slot', async () => {
    const { before, after, text } = rume(TABLE('(import "m" "tab" (table $tab 2 2 funcref))'));
    expect(count(text, 'global.set')).toBe(1);
    const viaHost = async (b: Uint8Array) => {
      const tab = new WebAssembly.Table({ initial: 2, maximum: 2, element: 'anyfunc' });
      await WebAssembly.instantiate(b as BufferSource, { m: { tab } });
      try {
        return String((tab.get(1) as Fn)(3, 4));
      } catch (e) {
        return `${(e as Error).name}`;
      }
    };
    expect(await viaHost(after)).toBe(await viaHost(before));
  });

  it('a table.get: the reference read out may be called with call_ref', async () => {
    const { before, after, text } = rume(
      TABLE(
        undefined,
        `(func (export "viaRef") (param i32 i32)
        (call_ref $t2 (local.get 0) (local.get 0)
          (ref.cast (ref $t2) (table.get $tab (local.get 1)))))`,
      ),
    );
    expect(count(text, 'global.set')).toBe(1);
    await same(before, after, [['viaRef', [5, 1]], ['call1', [5, 0]]]);
  });

  it('a type with a supertype: a call_indirect of the supertype reaches the subtype', async () => {
    const { before, after, text } = rume(`(module
      (type $a (sub (func (result anyref))))
      (type $b (sub $a (func (result eqref))))
      (table $tab 1 1 funcref)
      (elem (table $tab) (i32.const 0) func $f)
      (func $f (type $b) (ref.i31 (i32.const 42)))
      (func (export "call") (result i32)
        (ref.is_null (call_indirect $tab (type $a) (i32.const 0)))))`);
    expect(text).toContain('ref.i31');
    await same(before, after, [['call', []]]);
  });
});
