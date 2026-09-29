/**
 * @module binaryen-ts/tests/passes/minify_imports_and_exports_test
 *
 * `MinifyImports`, `MinifyImportsAndExports`, `MinifyImportsAndExportsAndModules`
 * — the interface strings renamed, the map the host applies. Every expected
 * map below is what upstream `wasm-opt` 132 printed for the same module
 * (2026-09-28); the behaviour THROUGH the map is `deno task spec-behaviour`'s
 * "minify through its map" variant.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';

import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { writeWasm } from '../../../src/binaryen-ts/ir/write-wasm.ts';
import {
  formatMinifyMap,
  minifyImportsAndExports,
  type MinifyMap,
  PassRunner,
  takeMinifyMap,
} from '../../../src/binaryen-ts/passes/index.ts';
import { wasmOpt } from '../../../src/binaryen-ts/tools/wasm-opt.ts';

const WAT = `(module
 (import "env" "log" (func $log (param i32)))
 (import "wasi_snapshot_preview1" "fd_write" (func $fdw (param i32 i32 i32 i32) (result i32)))
 (import "wasi_snapshot_preview1" "proc_exit" (func $pe (param i32)))
 (import "other" "log" (func $log2 (param i32)))
 (import "env" "memory" (memory 1))
 (global (import "env" "g") i32)
 (func (export "main") (call $log (i32.const 1)))
 (func (export "helper") (param i32) (result i32) (local.get 0))
 (export "mem" (memory 0))
 (export "main2" (func 4)))`;

/** Upstream `wasm-opt --minify-imports-and-exports-and-modules`'s map. */
const UPSTREAM_AND_MODULES = `{
 "imports": [
  ["env", "memory", "a"],
  ["env", "g", "b"],
  ["env", "log", "c"],
  ["wasi_snapshot_preview1", "fd_write", "d"],
  ["wasi_snapshot_preview1", "proc_exit", "e"],
  ["other", "log", "f"]
 ],
"exports": [
  ["main", "g"],
  ["helper", "h"],
  ["mem", "i"],
  ["main2", "j"]
 ]
}
`;

/** Upstream `wasm-opt --minify-imports`'s map: `other` is not renamed. */
const UPSTREAM_IMPORTS = `{
 "imports": [
  ["env", "memory", "a"],
  ["env", "g", "b"],
  ["env", "log", "c"],
  ["wasi_snapshot_preview1", "fd_write", "d"],
  ["wasi_snapshot_preview1", "proc_exit", "e"]
 ],
"exports": [
 ]
}
`;

/** Run one pass through the runner, as `wasm-opt --<name>` does. */
function runPass(name: string) {
  const m = readWat(WAT);
  new PassRunner(m, {}).add(name).run();
  return { m, map: takeMinifyMap(m)! };
}

const iface = (bytes: Uint8Array) => {
  const mod = new WebAssembly.Module(bytes as BufferSource);
  return {
    imports: WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`),
    exports: WebAssembly.Module.exports(mod).map((e) => e.name),
  };
};

Deno.test("minify: the map is upstream's, name for name", () => {
  assertEquals(
    formatMinifyMap(runPass('minify-imports-and-exports-and-modules').map),
    UPSTREAM_AND_MODULES,
  );
  assertEquals(formatMinifyMap(runPass('minify-imports').map), UPSTREAM_IMPORTS);
});

Deno.test('minify: the bytes carry exactly the names the map gives', () => {
  const { m } = runPass('MinifyImportsAndExportsAndModules');
  assertEquals(iface(writeWasm(m)), {
    imports: ['a.c', 'a.d', 'a.e', 'a.f', 'a.a', 'a.b'], // import ORDER is kept
    exports: ['g', 'h', 'i', 'j'],
  });
  const only = runPass('MinifyImports');
  assertEquals(iface(writeWasm(only.m)), {
    imports: [
      'env.c',
      'wasi_snapshot_preview1.d',
      'wasi_snapshot_preview1.e',
      'other.log',
      'env.a',
      'env.b',
    ],
    exports: ['main', 'helper', 'mem', 'main2'],
  });
});

Deno.test('minify: a host that applies the map sees the same module', () => {
  const orig = writeWasm(readWat(WAT));
  const { m, map } = runPass('MinifyImportsAndExportsAndModules');
  const min = writeWasm(m);
  let logged = -1;
  const host = {
    log: (x: number) => void (logged = x),
    memory: new WebAssembly.Memory({ initial: 1 }),
    g: new WebAssembly.Global({ value: 'i32', mutable: false }, 7),
    any: () => 0,
  };
  const value = (field: string) => (host as Record<string, unknown>)[field] ?? host.any;
  // The original under its names…
  const origImports: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(new WebAssembly.Module(orig as BufferSource))) {
    (origImports[i.module] ??= {})[i.name] = value(i.name);
  }
  // …and the minified one under the map's.
  const minImports: Record<string, Record<string, unknown>> = {};
  for (const [mod, field, now] of map.imports) {
    (minImports[map.module ?? mod] ??= {})[now] = value(field);
  }
  for (const [mod, field] of [['other', 'log']]) {
    assert(
      map.imports.some(([m2, f]) => m2 === mod && f === field),
      'under -and-modules every import is mapped',
    );
  }
  const a = new WebAssembly.Instance(
    new WebAssembly.Module(orig as BufferSource),
    origImports as WebAssembly.Imports,
  ).exports;
  const b = new WebAssembly.Instance(
    new WebAssembly.Module(min as BufferSource),
    minImports as WebAssembly.Imports,
  ).exports;
  const exp = new Map(map.exports);
  (a.main as () => void)();
  const fromOriginal = logged;
  logged = -1;
  (b[exp.get('main')!] as () => void)();
  assertEquals(logged, fromOriginal);
  assertEquals(
    (b[exp.get('helper')!] as (x: number) => number)(41),
    (a.helper as (x: number) => number)(41),
  );
  assert(b[exp.get('mem')!] instanceof WebAssembly.Memory);
});

Deno.test('minify: two imports of one (module, field) share one name and one entry', () => {
  const m = readWat(`(module
    (import "env" "f" (func (param i32)))
    (import "env" "f" (func (param i32)))
    (import "wasi" "y" (func))
    (import "wasi_unstable" "x" (func)))`);
  const map = minifyImportsAndExports(m, { exports: false, modules: false });
  assertEquals(map.imports, [['env', 'f', 'a'], ['wasi_unstable', 'x', 'b']]); // `wasi` is not `wasi_*`
  assertEquals(m.imports.map((i) => `${i.module}.${i.field}`), [
    'env.a',
    'env.a',
    'wasi.y',
    'wasi_unstable.b',
  ]);
});

Deno.test('minify: the name sequence skips reserved words, as upstream', () => {
  // Upstream's 4,000-name sequence (measured): …, `h`, then the 55th name is
  // `aa`; `if`, `in` and `do` never appear.
  let wat = '(module\n';
  for (let i = 0; i < 4000; i++) wat += ` (func (export "e${i}"))\n`;
  const map = minifyImportsAndExports(readWat(wat + ')'), { exports: true, modules: false });
  const byOld = new Map(map.exports);
  assertEquals([0, 25, 26, 51, 52, 53, 54, 55, 108].map((i) => byOld.get(`e${i}`)), [
    'a',
    'z',
    'A',
    'Z',
    '_',
    '$',
    'aa',
    'ba',
    'ab',
  ]);
  const all = new Set(byOld.values());
  for (const w of ['if', 'in', 'do']) assert(!all.has(w), w);
  assertEquals(all.size, 4000);
  // Listed sorted by NEW name, as upstream prints it: `$` … `A` … `_` … `a`,
  // not the order the names were made in.
  const listed = map.exports.map(([, n]) => n);
  assertEquals(listed.slice(0, 3), ['$', '$$', '$0']); // upstream's first three (measured)
  assertEquals(listed, [...listed].sort());
});

Deno.test('wasm-opt: --minify-imports-and-exports hands over the map, once, under --converge too', async () => {
  const path = await Deno.makeTempFile({ suffix: '.wasm' });
  try {
    await Deno.writeFile(path, writeWasm(readWat(WAT)));
    for (const converge of [false, true]) {
      const maps: MinifyMap[] = [];
      const out = await wasmOpt(path, {
        passes: ['minify-imports-and-exports'],
        converge,
        onMinifyMap: (m) => maps.push(m),
      });
      assertEquals(maps.length, 1);
      // Composed across rounds: still keyed by the ORIGINAL names.
      assertEquals(maps[0]!.exports.map(([o]) => o).sort(), ['helper', 'main', 'main2', 'mem']);
      const now = new Set(iface(out as Uint8Array).exports);
      for (const [, n] of maps[0]!.exports) assert(now.has(n), `${converge}: ${n}`);
    }
  } finally {
    await Deno.remove(path);
  }
});

Deno.test('minify: a second run COMPOSES — the map still starts from the originals', () => {
  const m = readWat(WAT);
  new PassRunner(m, {}).add('MinifyImportsAndExports').run();
  new PassRunner(m, {}).add('MinifyImportsAndExportsAndModules').run();
  const map: MinifyMap = takeMinifyMap(m)!;
  // Every original export name maps to the name it has NOW.
  const now = new Set(m.exports.map((e) => e.name));
  assertEquals(map.exports.map(([o]) => o).sort(), ['helper', 'main', 'main2', 'mem']);
  for (const [, n] of map.exports) assert(now.has(n), n);
  // Every original import maps to the field it has now, under module `a`.
  const imports = new Set(m.imports.map((i) => `${i.module}.${i.field}`));
  assertEquals(map.imports.length, 6);
  for (const [, , n] of map.imports) assert(imports.has(`a.${n}`), n);
  assertEquals(takeMinifyMap(m), undefined, 'taken once');
});
