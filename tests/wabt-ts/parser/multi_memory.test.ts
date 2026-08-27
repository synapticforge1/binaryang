// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Tranche 3 of the spec-testsuite parse-gap scope: multi-memory.
//
// The IR already carried `memidx: Var` on every memory op and the binary
// writer already knew the multi-memory memarg encoding (bit 6 of the align
// field signals that a memory index follows). Three things were missing:
//
//   1. `parseMemidxOpt` accepted ONLY the parenthesized `(memory $m)` form,
//      not the BARE var the spec grammar actually uses on instructions --
//      `i32.load $mem offset=0`, `memory.size $mem`. Every bare memory index
//      failed with "expected ), got Var"; that alone was 33 testsuite files.
//
//   2. `resolveNames` never walked `memidx` on ANY memory instruction, so a
//      NAMED memory reached the binary writer as an unresolved name-var and
//      hit its fail-loud guard. Same Bug G class as call_indirect's typeVar:
//      an immediate that names something must be resolved, or the writer
//      either throws or silently emits index 0. `memory.size` needed its own
//      case -- it is a leaf with no sub-expressions, so it fell through the
//      "nothing to resolve" default while still carrying a memidx.
//
//   3. `memory.init`'s one-var form names the DATA segment, and the two-var
//      form is `memory.init $memidx $dataidx` -- the indices must SWAP when a
//      second var appears, exactly like table.init.
//
// Accepting a bare memory index introduced an ambiguity for SIMD lane ops:
// `v128.load8_lane memarg laneidx` ends with a MANDATORY lane index, so a
// lone integer is the LANE, not a memory. Upstream wabt disambiguates by
// lookahead -- a bare Nat is a memory index only when followed by `offset=`,
// `align=`, or a second Nat -- and `parseSimdLaneMemidxOpt` does the same.
// Without it `(v128.load8_lane 3 ...)` silently read lane 3 as memory 3,
// which is how the existing Tier C bridge tests caught the regression.
//
// Testsuite: 179 -> 214/257 clean, zero regressions.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import type { SimdLoadLaneExpr } from '../../../src/wabt-ts/ir/ir.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

async function instantiate(wat: string): Promise<WebAssembly.Instance> {
  const binary = compile(wat);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  const { instance } = await WebAssembly.instantiate(buf);
  return instance;
}

const TWO_MEMS = `(module
  (memory $m0 1)
  (memory $m1 1)
  (data $d0 "AAAA")
  (func (export "distinct") (result i32)
    (i32.store $m1 (i32.const 0) (i32.const 1234))
    (i32.store $m0 (i32.const 0) (i32.const 9999))
    (i32.load $m1 (i32.const 0)))
  (func (export "sizes") (result i32)
    (i32.add (memory.size $m0) (memory.size $m1)))
  (func (export "initd") (result i32)
    (memory.init $m1 $d0 (i32.const 4) (i32.const 0) (i32.const 4))
    (i32.load8_u $m1 (i32.const 4)))
  (func (export "cp") (result i32)
    (i32.store $m1 (i32.const 0) (i32.const 1234))
    (memory.copy $m0 $m1 (i32.const 8) (i32.const 0) (i32.const 4))
    (i32.load $m0 (i32.const 8)))
  (func (export "fill") (result i32)
    (memory.fill $m1 (i32.const 16) (i32.const 3) (i32.const 4))
    (i32.load8_u $m1 (i32.const 17))))`;

describe('multi-memory — named memory index on instructions', () => {
  it('load/store target the named memory, not memory 0', async () => {
    const inst = await instantiate(TWO_MEMS);
    // 1234 was stored into $m1 and 9999 into $m0; reading $m1 must see 1234.
    assertEquals((inst.exports.distinct as () => number)(), 1234);
  });

  it('memory.size resolves per memory', async () => {
    const inst = await instantiate(TWO_MEMS);
    assertEquals((inst.exports.sizes as () => number)(), 2);
  });

  it('memory.copy moves between two distinct memories', async () => {
    const inst = await instantiate(TWO_MEMS);
    assertEquals((inst.exports.cp as () => number)(), 1234);
  });

  it('memory.fill targets the named memory', async () => {
    const inst = await instantiate(TWO_MEMS);
    assertEquals((inst.exports.fill as () => number)(), 3);
  });

  it('numeric bare index works too', () => {
    compile('(module (memory 1) (memory 1) (func (result i32) (i32.load 1 (i32.const 0))))');
  });

  it('the parenthesized (memory $m) form still works', () => {
    compile(
      '(module (memory $a 1) (memory $b 1) (func (result i32) (i32.load (memory $b) (i32.const 0))))',
    );
  });

  it('offset=/align= still parse after a memory index', () => {
    compile(
      '(module (memory $a 1) (memory $b 1) (func (result i32) (i32.load $b offset=4 align=4 (i32.const 0))))',
    );
  });
});

describe('memory.init index order', () => {
  it('two-var form is (memory, data)', async () => {
    const inst = await instantiate(TWO_MEMS);
    // $d0 is "AAAA"; initialising $m1 then reading it back must give 'A'.
    assertEquals((inst.exports.initd as () => number)(), 65);
  });

  it('one-var form names the DATA segment, memory defaults to 0', async () => {
    const inst = await instantiate(`(module
      (memory $m0 1)
      (memory $m1 1)
      (data $d0 "AAAA")
      (func (export "f") (result i32)
        (memory.init $d0 (i32.const 0) (i32.const 0) (i32.const 4))
        (i32.load8_u $m0 (i32.const 0))))`);
    assertEquals((inst.exports.f as () => number)(), 65);
  });
});

describe('multi-memory — name resolution', () => {
  it('resolveNames resolves a named memidx to its index', () => {
    const { module, errors } = parseWatModule(
      '(module (memory $a 1) (memory $b 1) (func (result i32) (memory.size $b)))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, errors);
    const e = module.funcs[0]!.body.find((x) => x.kind === 'memory.size');
    assert(e && e.kind === 'memory.size');
    // $b is memory index 1 — an unresolved name-var would still be 'name'
    // here and the writer would reject it.
    assertEquals(e.memidx.kind, 'index');
    assertEquals(e.memidx.kind === 'index' ? e.memidx.value : -1, 1);
  });

  it('reports an unknown memory name rather than emitting index 0', () => {
    const { module, errors } = parseWatModule(
      '(module (memory $a 1) (func (result i32) (memory.size $nope)))',
    );
    resolveNames(module, errors);
    assert(hasErrors(errors), 'expected an error for an undefined memory name');
  });
});

describe('multi-memory — round-trip', () => {
  it('wasm2wat preserves the memory index and re-encodes identically', async () => {
    const binary = compile(TWO_MEMS);
    const { text, errors } = wasm2wat(binary);
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    assert(text);
    assert(/i32\.store 1/.test(text), `expected an explicit memory index:\n${text}`);
    const inst = await instantiate(text);
    assertEquals((inst.exports.distinct as () => number)(), 1234);
    assertEquals((inst.exports.cp as () => number)(), 1234);
    // memory.init specifically: the WAT writer emitted the BINARY operand
    // order (dataidx then memidx) instead of the text order (memory first),
    // so this re-parsed transposed and V8 rejected it with
    // "invalid data segment index".
    assertEquals((inst.exports.initd as () => number)(), 65);
  });

  it('emits memory.init in TEXT operand order (memory first)', () => {
    const { text } = wasm2wat(compile(TWO_MEMS));
    assert(text);
    const line = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('memory.init'));
    assert(line, 'expected a memory.init in the output');
    // $m1 is memory 1 and $d0 is data segment 0 -> "memory.init 1 0".
    assertEquals(line.replace(/\)+$/, '').trim(), 'memory.init 1 0');
  });
});

describe('SIMD lane ops — memidx vs lane disambiguation', () => {
  function laneAndMem(wat: string): { lane: number; mem: number } {
    const { module, errors } = parseWatModule(wat);
    if (hasErrors(errors)) throw new Error(formatErrors(errors));
    resolveNames(module, errors);
    const e = module.funcs[0]!.body.find((x) => x.kind === 'simd_load_lane') as
      | SimdLoadLaneExpr
      | undefined;
    assert(e, 'expected a simd_load_lane');
    assertEquals(e.memidx.kind, 'index');
    return { lane: e.lane, mem: e.memidx.kind === 'index' ? e.memidx.value : -1 };
  }

  const HEAD = '(module (memory $a 1) (memory $b 1) (func (param v128) (result v128) ';
  const TAIL = ' (i32.const 0) (local.get 0))))';

  it('a lone integer is the LANE, not a memory index', () => {
    // The regression the Tier C bridge tests caught.
    assertEquals(laneAndMem(`${HEAD}(v128.load8_lane 3${TAIL}`), { lane: 3, mem: 0 });
  });

  it('two integers are (memory, lane)', () => {
    assertEquals(laneAndMem(`${HEAD}(v128.load8_lane 1 1${TAIL}`), { lane: 1, mem: 1 });
  });

  it('an integer followed by offset= is a memory index', () => {
    assertEquals(laneAndMem(`${HEAD}(v128.load8_lane 1 offset=0 2${TAIL}`), { lane: 2, mem: 1 });
  });

  it('a named memory is unambiguous', () => {
    assertEquals(laneAndMem(`${HEAD}(v128.load8_lane $b 2${TAIL}`), { lane: 2, mem: 1 });
  });

  it('the (memory $m) form is unambiguous', () => {
    assertEquals(laneAndMem(`${HEAD}(v128.load8_lane (memory $b) 2${TAIL}`), { lane: 2, mem: 1 });
  });
});
