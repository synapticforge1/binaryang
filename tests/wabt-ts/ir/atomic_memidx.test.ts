// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `resolveNames` skipped `memidx` on two of the six atomic memory ops.
//
// `atomic_rmw_cmpxchg` and `atomic_wait` resolved their operand expressions and
// spread `...e` — carrying the memory reference through UNCHANGED. Their
// immediate neighbours in the same switch both do it correctly:
//
//     case 'atomic_load':  ... memidx: this.resolveMemoryVar(e.memidx, loc)   OK
//     case 'atomic_rmw_cmpxchg': ... { ...e, address, expected, replacement }  BUG
//     case 'atomic_wait':        ... { ...e, address, expected, timeout }      BUG
//     case 'atomic_notify': ... memidx: this.resolveMemoryVar(e.memidx, loc)  OK
//
// So a named multi-memory operand stayed a name-var, and the binary writer's
// `writeMemoryVarUnlessZero` saw a var it could not read as an index and wrote
// **0**. The instruction silently operated on the WRONG MEMORY:
//
//     (i32.atomic.rmw.cmpxchg $m2 ...)   ->   hits $m1
//
// Valid wasm, V8 accepts it, no diagnostic anywhere — the same class as T9.1
// (the decoder reordering a program) and exactly Bug G's shape: a `case` that
// exists and resolves SOME of its Vars.
//
// Found by auditing every `Var`-bearing Expr interface against the case body
// that handles it, rather than by a corpus. Neither corpus reaches it: the spec
// testsuite has no named multi-memory atomics, and wasic emits neither.
// That is the same reason the standing "no name-var survives resolveNames"
// guard missed it — a guard is only as wide as its corpus.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

/** The `memidx` var of the first expression carrying one, at any depth. */
// deno-lint-ignore no-explicit-any
function findMemidx(x: any): { kind: string; name?: string; value?: number } | null {
  if (!x || typeof x !== 'object') return null;
  if (x.memidx) return x.memidx;
  for (const k of Object.keys(x)) {
    if (k === 'loc') continue;
    const v = x[k];
    const hit = Array.isArray(v) ? v.map(findMemidx).find(Boolean) : findMemidx(v);
    if (hit) return hit;
  }
  return null;
}

function memidxAfterResolve(instr: string) {
  const { module, errors } = parseWatModule(`(module
    (memory $m1 1 1 shared)
    (memory $m2 1 1 shared)
    (func (export "f") ${instr}))`);
  assert(!hasErrors(errors), formatErrors(errors));
  const errs = makeErrorList();
  resolveNames(module, errs);
  return findMemidx(module.funcs[0]!.body[0]);
}

const NAMED_SECOND_MEMORY: [string, string][] = [
  ['atomic_load', '(drop (i32.atomic.load $m2 (i32.const 0)))'],
  ['atomic_store', '(i32.atomic.store $m2 (i32.const 0) (i32.const 1))'],
  ['atomic_rmw', '(drop (i32.atomic.rmw.add $m2 (i32.const 0) (i32.const 1)))'],
  [
    'atomic_rmw_cmpxchg',
    '(drop (i32.atomic.rmw.cmpxchg $m2 (i32.const 0) (i32.const 1) (i32.const 2)))',
  ],
  ['atomic_wait', '(drop (memory.atomic.wait32 $m2 (i32.const 0) (i32.const 1) (i64.const -1)))'],
  ['atomic_notify', '(drop (memory.atomic.notify $m2 (i32.const 0) (i32.const 1)))'],
];

describe('resolveNames resolves memidx on EVERY atomic memory op', () => {
  for (const [name, instr] of NAMED_SECOND_MEMORY) {
    it(`resolves the named memory on ${name}`, () => {
      const v = memidxAfterResolve(instr);
      assert(v, `${name}: no memidx found`);
      assertEquals(v.kind, 'index', `${name}: memidx left as a name-var`);
      assertEquals(v.value, 1, `${name}: resolved to the wrong memory`);
    });
  }
});

describe('the atomic op operates on the memory the source named', () => {
  it('cmpxchg against $m2 lands on $m2, not $m1', async () => {
    // The behavioural half. Byte-level assertions would have passed the whole
    // time this was broken — index 0 is a perfectly good encoding, just of a
    // different program.
    const { binary, errors } = wat2wasm(`(module
      (memory $m1 (export "m1") 1 1 shared)
      (memory $m2 (export "m2") 1 1 shared)
      (func (export "go")
        (i32.atomic.store $m1 (i32.const 0) (i32.const 0))
        (i32.atomic.store $m2 (i32.const 0) (i32.const 0))
        (drop (i32.atomic.rmw.cmpxchg $m2 (i32.const 0) (i32.const 0) (i32.const 99)))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);

    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    assertEquals(WebAssembly.validate(buf), true, 'fixture must be valid');

    const { instance } = await WebAssembly.instantiate(buf, {});
    (instance.exports.go as () => void)();
    const m1 = new Int32Array((instance.exports.m1 as WebAssembly.Memory).buffer);
    const m2 = new Int32Array((instance.exports.m2 as WebAssembly.Memory).buffer);
    assertEquals(m2[0], 99, 'the cmpxchg did not reach $m2');
    assertEquals(m1[0], 0, 'the cmpxchg hit $m1 instead');
  });

  it('wait32 against $m2 encodes memory 1', () => {
    // `memory.atomic.wait32` traps on a non-shared main thread, so pin the
    // encoding rather than the runtime behaviour.
    const { binary, errors } = wat2wasm(`(module
      (memory $m1 1 1 shared) (memory $m2 1 1 shared)
      (func (export "f")
        (drop (memory.atomic.wait32 $m2 (i32.const 0) (i32.const 1) (i64.const -1)))))`);
    assert(!hasErrors(errors), formatErrors(errors));
    assert(binary);
    // 0xfe 0x01 = memory.atomic.wait32, then align, then the memidx byte.
    const i = binary.findIndex((b, j) => b === 0xfe && binary[j + 1] === 0x01);
    assert(i >= 0, 'wait32 opcode not found');
    // memarg: align byte carries the multi-memory flag (bit 6), then memidx.
    const align = binary[i + 2]!;
    assert(align & 0x40, 'expected the multi-memory memarg form');
    assertEquals(binary[i + 3], 1, 'wait32 encoded the wrong memory index');
  });
});
