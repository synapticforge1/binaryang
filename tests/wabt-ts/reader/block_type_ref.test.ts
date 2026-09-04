// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A block result may be a TYPED REFERENCE, and the heap type that follows the
// tag byte is part of it.
//
// `BlockType`'s value case was typed `Type` — a flat numeric enum whose values
// are single wire bytes. A typed reference does not fit: `(ref ht)` encodes as
// `0x64` FOLLOWED BY a heap type. So the reader took the tag and left the heap
// index in the instruction stream, where the next decode step consumed it as an
// OPCODE:
//
//     (block (result (ref 0)) (ref.func 0))
//       upstream : block (result (ref 0)) / ref.func 0
//       ours     : block <type 100> / UNREACHABLE / ref.func
//
// ⚠️ **And it round-tripped BYTE-IDENTICALLY**, because the writer emitted that
// phantom `unreachable` as the very byte it had been mis-read from. The two
// halves of one gap concealed each other: the writer's `bt.type as number` was
// equally broken, and only ever looked right because the reader could not
// produce a typed ref for it to mishandle.
//
// 🔑 **Byte equality is not semantic equality, and this is the proof.** The
// corpus round trip — 421/421 byte-identical, the strongest signal this project
// had — was blind to an IR carrying an instruction the program does not contain.
// A phantom `unreachable` makes everything after it dead code, so any pass or
// analysis reading that IR would have drawn conclusions from a different program.
//
// Found through the spec testsuite, which saw the same gap from the other side:
// a heap index that is never stored can never be range-checked, so two INVALID
// modules were ACCEPTED (`ref.wast:65,69`). Fixing the representation closed
// both, and took the suite to 100% on all four axes.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { isRefValueType } from '../../../src/wabt-ts/ir/ir.ts';
import type { Expr } from '../../../src/wabt-ts/ir/ir.ts';

/**
 * Every expression kind in a body, depth-first — a phantom shows up here.
 *
 * ⚠️ Walks named child fields rather than every object property. A generic walk
 * also descends into `blockType` (`{kind:'value'}`), its ref type
 * (`{kind:'ref'}`) and the heap type (`{kind:'index'}`), all of which carry a
 * `kind` and none of which are expressions — so the first version of this
 * helper reported those as instructions. Being wrong about what counts as a
 * child is how the defect under test got in; it should not also be how the test
 * measures it.
 */
const CHILD_FIELDS = [
  'body',
  'then_',
  'else_',
  'value',
  'values',
  'operand',
  'cond',
  'address',
  'args',
  'operands',
  'catches',
] as const;

function kindsIn(exprs: readonly Expr[]): string[] {
  const out: string[] = [];
  const walk = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return;
    const rec = e as Record<string, unknown>;
    if (typeof rec['kind'] === 'string') out.push(rec['kind'] as string);
    for (const key of CHILD_FIELDS) {
      const v = rec[key];
      if (Array.isArray(v)) { for (const c of v) walk(c); }
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const e of exprs) walk(e);
  return out;
}

/**
 * A module using the INLINE typed-reference block type, built byte by byte.
 *
 * ⚠️ It has to be hand-built. Our own `wat2wasm` encodes this block with the
 * TYPE-INDEX form (`02 01`) rather than the inline one (`02 64 00`) — both are
 * legal, but only the inline form has a heap type following the tag, which is
 * the path under test. A fixture assembled by our own writer would silently
 * exercise the wrong encoding and pass either way.
 *
 *   type   : 1 entry, `(func)`
 *   func   : 1 function of type 0
 *   code   : block (result (ref 0)) / unreachable / end / drop / end
 *
 * This is `ref.wast:65`'s module with the heap index corrected from the
 * out-of-range 1 to the valid 0.
 */
const INLINE_REF_BLOCK = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00, // magic + version
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00, //             type: (func)
  0x03,
  0x02,
  0x01,
  0x00, //                         func: [type 0]
  0x0a,
  0x0a,
  0x01,
  0x08,
  0x00, //                   code: 1 body, 8 bytes, 0 locals
  0x02,
  0x64,
  0x00, //                                 block (result (ref 0))
  0x00, //                                               unreachable
  0x0b, //                                             end
  0x1a, //                                             drop
  0x0b, //                                           end
]);

describe('binary reader — a typed-reference block type', () => {
  it('decodes with NO phantom instruction in the body', () => {
    assert(WebAssembly.validate(INLINE_REF_BLOCK as BufferSource), 'fixture must be valid wasm');
    const mod = readBinaryIr(INLINE_REF_BLOCK, makeErrorList());
    const fn = mod.funcs[0]!;
    // drop( block( unreachable ) ). The heap-type byte becoming a SECOND
    // `unreachable` is the defect this pins.
    assertEquals(kindsIn(fn.body), ['drop', 'block', 'unreachable']);
  });

  it('keeps the heap type, rather than collapsing to the tag byte', () => {
    const mod = readBinaryIr(INLINE_REF_BLOCK, makeErrorList());
    const drop = mod.funcs[0]!.body[0] as { value?: { blockType?: unknown } };
    const bt = drop.value?.blockType as { kind: string; type?: unknown } | undefined;
    assert(bt && bt.kind === 'value', 'the block must carry a value block type');
    assert(isRefValueType(bt.type as never), 'the block type must be a typed reference');
    assertEquals((bt.type as { heapType: { value: number } }).heapType.value, 0);
  });

  // ⚠️ Kept even though it passed BEFORE the fix — it is the assertion that gave
  // false confidence. Its job now is to show correctness and byte equality
  // finally agreeing, not to detect the bug.
  it('still re-encodes byte-identically', () => {
    const out = writeBinaryIr(readBinaryIr(INLINE_REF_BLOCK, makeErrorList()));
    assertEquals(Array.from(out), Array.from(INLINE_REF_BLOCK));
    assert(WebAssembly.validate(out as BufferSource), 'and the engine must accept it');
  });
});

describe('validator — a block result names a real type', () => {
  const rejects = (wat: string): boolean => {
    const asm = wat2wasm(wat, { filename: 'src.wat' });
    if (!asm.binary || hasErrors(asm.errors)) return true;
    const errors = makeErrorList();
    const mod = readBinaryIr(asm.binary, errors);
    if (hasErrors(errors)) return true;
    validateModule(mod, errors, { features: allFeatures() });
    return hasErrors(errors);
  };

  // ref.wast:65 and :69 — the spec requires "unknown type". A heap index that
  // is never stored can never be range-checked, which is why the two halves of
  // this defect had to be fixed together.
  it('rejects a block whose result names a type out of range', () => {
    assert(
      rejects('(module (func $b (drop (block (result (ref 1)) (unreachable)))))'),
      'block (result (ref 1)) with one type must be rejected',
    );
  });

  it('rejects a loop whose result names a type out of range', () => {
    assert(
      rejects('(module (func $l (drop (loop (result (ref 1)) (unreachable)))))'),
      'loop (result (ref 1)) with one type must be rejected',
    );
  });

  it('ACCEPTS the same shape when the type exists — the control', () => {
    const errors = makeErrorList();
    const mod = readBinaryIr(INLINE_REF_BLOCK, errors);
    assert(!hasErrors(errors), 'the valid module must decode');
    validateModule(mod, errors, { features: allFeatures() });
    assert(!hasErrors(errors), 'a valid typed-ref block must still pass');
  });
});
