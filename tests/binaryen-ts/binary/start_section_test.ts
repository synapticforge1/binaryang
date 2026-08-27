/**
 * @module binaryen-ts/tests/binary/start_section_test
 *
 * Regression tests for UP-5 — the start section (id 8) was parsed and thrown
 * away (`this.r.readU32(); break; // skip`), and the encoder had no emit path
 * for it at all. A module whose start function initialized state therefore
 * round-tripped into a module that instantiated cleanly and never ran it:
 * valid wasm, wrong behaviour, no diagnostic. That is the same silent-drop
 * class as the WT-2c element-segment bug.
 *
 * Wiring the section up is not sufficient on its own. The start function is a
 * reachability root exactly like an export, so `RemoveUnusedModuleElements`
 * and `Inlining` must seed from it — otherwise `-Oz` deletes a start function
 * that nothing else references, trading a decoder drop for an optimizer drop.
 * The `-Oz` test below is the one that pins that down.
 *
 * @license MIT
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { parseWasm } from '../../src/binary/index.ts';
import { encodeWasm, WasmEncodeError } from '../../src/encoder/index.ts';
import { makeGlobalSet, makeI32Const } from '../../src/ir/expressions.ts';
import { ModuleBuilder } from '../../src/ir/module.ts';
import { ValType } from '../../src/ir/types.ts';
import { PassRunner } from '../../src/passes/pass.ts';
import '../../src/passes/index.ts'; // side-effect: registers the pass registry

/**
 * Hand-built module: `global $g (mut i32) = 0`, `func $init { $g = 42 }`,
 * `start = $init`, `export "g" (global $g)`.
 *
 * `$init` is deliberately NOT exported and never called — the only thing
 * keeping it alive is the start section.
 */
const START_MODULE = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00, //             type: () -> ()
  0x03,
  0x02,
  0x01,
  0x00, //                         func: 1 func, type 0
  0x06,
  0x06,
  0x01,
  0x7f,
  0x01,
  0x41,
  0x00,
  0x0b, // global: (mut i32) = 0
  0x07,
  0x05,
  0x01,
  0x01,
  0x67,
  0x03,
  0x00, //       export "g" (global 0)
  0x08,
  0x01,
  0x00, //                               START = func 0
  0x0a,
  0x08,
  0x01,
  0x06,
  0x00,
  0x41,
  0x2a,
  0x24,
  0x00,
  0x0b, // code
]);

async function readGlobalG(bytes: Uint8Array): Promise<number> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const { instance } = await WebAssembly.instantiate(buf, {});
  return (instance.exports.g as WebAssembly.Global).value as number;
}

function hasSection(bytes: Uint8Array, id: number): boolean {
  let i = 8; // skip magic + version
  while (i < bytes.length) {
    const secId = bytes[i++];
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++];
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (secId === id) return true;
    i += size;
  }
  return false;
}

Deno.test('start section: the fixture actually runs its start function', async () => {
  assertEquals(await readGlobalG(START_MODULE), 42);
});

Deno.test('start section: survives a bare parse→encode round-trip', async () => {
  const out = encodeWasm(parseWasm(START_MODULE));
  assert(hasSection(out, 8), 're-encoded module is missing section 8');
  assertEquals(await readGlobalG(out), 42);
});

Deno.test('start section: parser records the start function under $func naming', () => {
  const mod = parseWasm(START_MODULE);
  assertEquals(mod.start, '$func0');
});

Deno.test('start section: a non-exported start function survives full -Oz', async () => {
  // The trap: RemoveUnusedModuleElements seeds liveness from exports and
  // element segments. `$func0` is neither — only `mod.start` keeps it alive.
  const mod = parseWasm(START_MODULE);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 })
    .addDefaultOptimizationPasses()
    .run();

  assertEquals(mod.start, '$func0');
  assert(
    mod.functions.some((f) => f.name === '$func0'),
    '-Oz deleted the start function',
  );

  const out = encodeWasm(mod);
  assert(hasSection(out, 8), 'optimized module is missing section 8');
  assertEquals(await readGlobalG(out), 42);
});

Deno.test('start section: absent start emits no section 8', () => {
  const mod = new ModuleBuilder()
    .addGlobal('$g', ValType.I32, true, makeI32Const(0))
    .addFunction('$f', [], [], makeGlobalSet('$g', makeI32Const(1)))
    .build();
  assertEquals(mod.start, null);
  assert(!hasSection(encodeWasm(mod), 8));
});

Deno.test('start section: setStart with an unknown name throws at encode time', () => {
  const mod = new ModuleBuilder()
    .addGlobal('$g', ValType.I32, true, makeI32Const(0))
    .addFunction('$f', [], [], makeGlobalSet('$g', makeI32Const(1)))
    .setStart('$nope')
    .build();

  assertThrows(
    () => encodeWasm(mod),
    WasmEncodeError,
    'unresolved start function reference: "$nope"',
  );
});
