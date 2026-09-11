// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// binaryen-ts could not represent a memory index, and its reader DESYNCED on one.
//
// `readMemArg` read align and offset straight through. Bit 6 of the align field
// means "an explicit memory index follows" (multi-memory), so for
// `i32.store (memory $b) …` — bytes `36 42 01 00` — it returned align 0x42 (a
// nonsense 2^66 alignment) and offset 1 (which is the MEMORY INDEX), then left
// the real offset byte in the stream where the next decode step consumed it as
// an OPCODE. A `00` became a phantom `unreachable`.
//
// 🔑 **That is the same failure shape as the typed-ref block type in wabt-ts**
// (`reader/block_type_ref.test.ts`): a byte read at the wrong width turns the
// remainder of a body into a different program. A phantom `unreachable` makes
// everything after it dead code, so any pass reading that body was reasoning
// about something the input never said.
//
// Nothing caught it. No error was raised at parse; `checkSingleMemory` in the
// encoder only fired if you went on to re-encode, and it reported the module as
// unsupported rather than the body as corrupt.
//
// ## Why the fix went this way
//
// The two IRs disagreed: wabt-ts carried `memidx` on 16 kinds, binaryen-ts on
// none. Under "the worst condition controls the design of the element", the
// controlling load combination is multi-memory, and only wabt-ts's shape carries
// it — so binaryen-ts's node gained the field rather than wabt-ts's losing it.
// Convergence in the other direction would have REGRESSED behaviour that already
// worked, which is the outcome the rule exists to prevent.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

// wabt-ts's bytes without the name section until N1 P5 -- see ../wabt_reference.ts.
import { wabtReference } from '../wabt_reference.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/wasm-encoder.ts';
import { varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import { ExpressionKind } from '../../../src/binaryen-ts/ir/expressions.ts';

/** Assemble with wabt-ts, which round-trips multi-memory correctly today. */
function assemble(wat: string): Uint8Array {
  const asm = wabtReference(wat, { filename: 'mm.wat' });
  assert(asm.binary, `fixture must assemble: ${wat.slice(0, 60)}`);
  assert(WebAssembly.validate(asm.binary as BufferSource), 'and the engine must accept it');
  return asm.binary;
}

/** Every node in a parsed body, depth-first. */
function nodesOf(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const go = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return;
    const rec = e as Record<string, unknown>;
    if (rec['kind'] === undefined) return;
    out.push(rec);
    for (
      const key of [
        'children',
        'body',
        'ptr',
        'value',
        'operands',
        'dest',
        'source',
        'size',
        'delta',
      ]
    ) {
      const v = rec[key];
      if (Array.isArray(v)) { for (const c of v) go(c); }
      else if (v && typeof v === 'object') go(v);
    }
  };
  go(root);
  return out;
}

const LOAD_STORE = `(module (memory $a 1) (memory $b 1)
  (func $f (param i32) (result i32)
    (i32.store (memory $b) (i32.const 0) (local.get 0))
    (i32.load (memory $b) (i32.const 0))))`;

describe('binaryen-ts — a memarg carrying an explicit memory index', () => {
  it('decodes align and offset correctly, rather than shifted by one field', () => {
    const mod = parseWasm(assemble(LOAD_STORE));
    const nodes = nodesOf(mod.functions[0]?.body);

    // Found by DISCRIMINANT. This matched on the field name `'bytes'` — a string
    // no compiler checks — so when Load/Store stopped carrying `bytes` it
    // matched nothing, and only the `assert` below kept that from being silent.
    const store = nodes.find((n) => n['kind'] === ExpressionKind.Store);
    assert(store, 'a store must be present');
    // The defect returned align 0x42 (66) and offset 1 — the memory index read
    // as the offset. Pinning all three is what makes this discriminating.
    assertEquals(store['align'], 2, 'align is the exponent with bit 6 masked off');
    assertEquals(store['offset'], 0n, 'offset is the real offset, not the memory index');
    assertEquals(store.memidx, varIndex(1), 'and the memory index is kept');
  });

  it('leaves NO phantom instruction behind', () => {
    const mod = parseWasm(assemble(LOAD_STORE));
    const nodes = nodesOf(mod.functions[0]?.body);
    // The stray offset byte used to be consumed as opcode 0x00 = `unreachable`,
    // which also made the enclosing block's type `unreachable`.
    const unreachable = nodes.filter((n) => n['type'] === 'unreachable');
    assertEquals(unreachable.length, 0, 'the body contains no unreachable node');
  });

  it('re-encodes byte-identically instead of refusing', () => {
    const input = assemble(LOAD_STORE);
    const out = encodeWasm(parseWasm(input));
    assertEquals(Array.from(out), Array.from(input));
    assert(WebAssembly.validate(out as BufferSource), 'and the engine accepts the result');
  });
});

describe('binaryen-ts — multi-memory beyond load and store', () => {
  const cases: Array<[string, string]> = [
    [
      'memory.copy across two memories',
      `(module (memory $a 1) (memory $b 1)
         (func $f (memory.copy (memory $b) (memory $a) (i32.const 0) (i32.const 0) (i32.const 4))))`,
    ],
    [
      'memory.fill on a second memory',
      `(module (memory $a 1) (memory $b 1)
         (func $f (memory.fill (memory $b) (i32.const 0) (i32.const 1) (i32.const 4))))`,
    ],
    [
      'memory.size and memory.grow on a second memory',
      `(module (memory $a 1) (memory $b 1)
         (func $f (result i32) (drop (memory.grow (memory $b) (i32.const 1))) (memory.size (memory $b))))`,
    ],
    [
      'an active data segment on a second memory',
      `(module (memory $a 1) (memory $b 1) (data (memory $b) (i32.const 0) "hi"))`,
    ],
    [
      'an exported second memory',
      `(module (memory $a 1) (memory $b 1) (export "m" (memory $b)))`,
    ],
  ];

  for (const [name, wat] of cases) {
    it(`round-trips ${name}`, () => {
      const input = assemble(wat);
      const out = encodeWasm(parseWasm(input));
      assert(WebAssembly.validate(out as BufferSource), 'the engine must accept the result');
      assertEquals(Array.from(out), Array.from(input));
    });
  }
});

describe('binaryen-ts — single-memory output is untouched', () => {
  // The memory field is omitted when zero, so nothing about a single-memory
  // module changes shape. The corpus baseline is the broader proof; this is the
  // direct one.
  it('still round-trips a plain single-memory module byte-identically', () => {
    const input = assemble(`(module (memory 1)
      (func $f (param i32) (result i32)
        (i32.store (i32.const 0) (local.get 0))
        (i32.load (i32.const 0))))`);
    const out = encodeWasm(parseWasm(input));
    assertEquals(Array.from(out), Array.from(input));
  });

  it('records no memory field on a memory-0 access', () => {
    const mod = parseWasm(
      assemble('(module (memory 1) (func $f (result i32) (i32.load (i32.const 0))))'),
    );
    const load = nodesOf(mod.functions[0]?.body).find((n) => n['kind'] === ExpressionKind.Load);
    assert(load, 'a load must be present');
    assertEquals(load.memidx, undefined, 'memory 0 is represented by absence');
  });
});
