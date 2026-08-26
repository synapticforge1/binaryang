/**
 * @module binaryen-ts/tests/passes/pick_load_signs_test
 *
 * PickLoadSigns may flip a narrow load between signed and unsigned ONLY when
 * every use of the loaded value re-extends it to the same width — then the
 * load's own extension is redundant and the choice is free. A single use that
 * OBSERVES the value makes the sign visible and the flip unsafe.
 *
 * The guard is `signedCount + unsignedCount === totalCount`. That is only sound
 * if the walk reaches every use: a use it never visits increments NEITHER
 * counter, so it is invisible rather than neutral, and the flip proceeds as
 * though it did not exist.
 *
 * The pass used to recurse through its own hand-written switch covering ~15
 * expression kinds with `default: break;`, so it never descended into a `br` /
 * `br_if` value, a `switch` value, `struct.set` / `array.set`, any SIMD node, a
 * `try` body, or a `tuple.make`. It now delegates to `visitChildren`, which
 * enumerates every kind and throws on an unhandled one.
 *
 * @license MIT
 */

import { assertEquals } from '@std/assert';
import { encodeWasm } from '../../src/encoder/index.ts';
import {
  BinaryOp,
  makeBinary,
  makeBlock,
  makeBreak,
  makeDrop,
  makeI32Const,
  makeLoad,
  makeLocalGet,
  makeLocalSet,
} from '../../src/ir/expressions.ts';
import { ModuleBuilder } from '../../src/ir/module.ts';
import { ValType } from '../../src/ir/types.ts';
import { PassRunner } from '../../src/passes/pass.ts';
import '../../src/passes/index.ts'; // side-effect: pass registration

/**
 * Byte 0 of memory is `0xFF`, so the narrow load reads either `-1` (signed) or
 * `255` (unsigned) — trivially distinguishable at runtime.
 *
 * ```wat
 * (func (export "f") (result i32) (local $x i32)
 *   (local.set $x (i32.load8_s (i32.const 0)))
 *   (drop (i32.and (local.get $x) (i32.const 0xff)))   ;; masked: safe to flip for
 *   (block $l (result i32) (br $l (local.get $x))))    ;; OBSERVES the value
 * ```
 *
 * Built as IR rather than WAT because the WAT parser does not accept the
 * `(br $l <value>)` folded form, and the point of the fixture is the branch
 * value.
 *
 * With the `br` use invisible to the walk, the pass saw only the mask,
 * concluded every use re-extends, and flipped `load8_s` to `load8_u` — turning
 * -1 into 255.
 */
function buildModule(): ReturnType<ModuleBuilder['build']> {
  const inner = makeBlock([makeBreak('$l', null, makeLocalGet(0, ValType.I32))], '$l');
  // A block whose body exits via `br` infers `unreachable`; stamp the declared
  // result type so the encoder emits an i32 blocktype.
  inner.type = ValType.I32;

  return new ModuleBuilder()
    .addMemory('mem0', 1)
    .addDataSegment('$d', makeI32Const(0), new Uint8Array([0xff]))
    .addFunction(
      '$f',
      [],
      [ValType.I32],
      makeBlock([
        makeLocalSet(0, makeLoad(1, true, 0, 0, makeI32Const(0), ValType.I32)),
        makeDrop(makeBinary(BinaryOp.AndI32, makeLocalGet(0, ValType.I32), makeI32Const(0xff))),
        inner,
      ]),
      [{ type: ValType.I32 }],
    )
    .addExport('f', '$f')
    .build();
}

function run(optimized: boolean): number {
  const mod = buildModule();
  if (optimized) {
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add('PickLoadSigns').run();
  }
  const bytes = encodeWasm(mod);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(buf), {});
  return (inst.exports.f as () => number)();
}

Deno.test('PickLoadSigns: a value carried by `br` is a real use, not an invisible one', () => {
  // The unoptimized program is the oracle.
  assertEquals(run(false), -1, 'fixture itself is wrong');
  // PickLoadSigns must not flip the load: the `br` observes the value.
  assertEquals(run(true), -1, 'load sign was flipped despite an observing `br` use');
});
