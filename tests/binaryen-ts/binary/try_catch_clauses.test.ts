// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 Group 2 decision: a `try`'s catch clauses are RECORDS, not the parallel
// `catchTags[]` / `catchBodies[]` arrays binaryen-ts carried.
//
// The parallel form was one fact in two places, and every mechanism around it
// existed to compensate:
//
//   - the ENCODER had a length guard, because a mismatched Try emitted a
//     `catch` opcode with no handler after it, corrupting the rest of the
//     function body;
//   - `catch_all` needed a SENTINEL tag, and the two halves of the codebase
//     disagreed about which — the parser wrote `$__catch_all` while the encoder
//     tested `tag === ''`, so every catch_all died with
//     "unresolved catch tag reference";
//   - `cfg.ts` carried a comment asserting the two arrays were the same length
//     "by construction".
//
// A clause cannot be half-present, and an absent `tag` cannot be spelled two
// ways, so all three are gone rather than merely passing.
//
// It also removed a capability gap: `catch_ref` / `catch_all_ref` threw
// "not yet supported" at the bridge, because there was no slot for the flag and
// dropping it would change what the handler receives.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import {
  asRegion,
  makeI32Const,
  makeNop,
  makeTry,
  tryCatch,
  tryCatchAll,
  type TryExpr,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { varName } from '../../../src/wabt-ts/ir/ir.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { soleInstr } from '../region_helpers.ts';

/**
 * Positions where two encodings differ, as `[index, a, b]`.
 *
 * ⚠️ A first version of this file scanned the WHOLE binary for 0x07/0x08/
 * 0x18/0x19 and asserted the list. Those bytes are also section ids, lengths
 * and type codes, so it collected an 0x08 from a section header and failed on
 * a correct encoding. Diffing two encodings that differ ONLY in the property
 * under test is self-anchoring: nothing else in the module can move.
 */
function byteDiff(a: Uint8Array, b: Uint8Array): Array<[number, number, number]> {
  assertEquals(a.length, b.length, 'encodings differ in length, not just opcode');
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) out.push([i, a[i]!, b[i]!]);
  }
  return out;
}

function tryModule(catches: TryExpr['catches']): ReturnType<ModuleBuilder['build']> {
  const m = new ModuleBuilder();
  m.addTag('$e', [ValType.I32]);
  m.addFunction('$f', [], [], makeTry(null, makeNop(), catches, null, None));
  return m.build();
}

describe('try catch clauses are records, not parallel arrays', () => {
  it('a catch_all clause has NO tag — absence is the representation', () => {
    const mod = parseWat(`(module
      (tag $e)
      (func $f (try $t (nop) (catch $e) (catch_all (nop)))))`);
    const t = soleInstr(mod.functions[0].body) as TryExpr;
    assertEquals(t.catches.length, 2);
    assertEquals(t.catches[0]!.tag, varName('$e'));
    assertEquals(t.catches[1]!.tag, undefined, 'catch_all carries no tag at all');
    // The sentinel is gone, so it cannot be spelled two ways: neither `''` nor
    // `$__catch_all` appears anywhere in the clause.
    assert(!('tag' in t.catches[1]!), 'the field is absent, not set to a sentinel');
  });

  it('a tag and its body cannot come apart', () => {
    // The old shape allowed catchTags.length !== catchBodies.length, which is
    // what the encoder's guard existed to reject. There is no way to express it
    // now — the clause IS the pairing — so this pins the pairing survives a
    // round trip rather than that a mismatch is rejected.
    const bytes = encodeWasm(tryModule([
      tryCatch(varName('$e'), makeNop()),
      tryCatchAll(makeNop()),
    ]));
    const back = parseWasm(bytes);
    const t = soleInstr(back.functions[0]!.body) as TryExpr;
    const kinds = t.catches.map((c) => (c.tag === undefined ? 'all' : 'tagged'));
    assertEquals(kinds, ['tagged', 'all']);
  });

  it('catch_ref changes exactly one byte: 0x07 becomes 0x08', () => {
    // The bridge threw "catch_ref / catch_all_ref not yet supported" because
    // the IR had no slot for the flag. The clause carries `isRef` now, and the
    // ONLY difference it makes to the encoding is the opcode.
    const plain = encodeWasm(tryModule([tryCatch(varName('$e'), makeNop())]));
    const ref = encodeWasm(tryModule([
      { tag: varName('$e'), isRef: true, body: asRegion(makeNop()) },
    ]));
    assertEquals(byteDiff(plain, ref), [[byteDiff(plain, ref)[0]![0], 0x07, 0x08]]);
  });

  it('catch_all_ref changes exactly one byte: 0x19 becomes 0x18', () => {
    const plain = encodeWasm(tryModule([tryCatchAll(makeNop())]));
    const ref = encodeWasm(tryModule([{ isRef: true, body: asRegion(makeNop()) }]));
    assertEquals(byteDiff(plain, ref), [[byteDiff(plain, ref)[0]![0], 0x19, 0x18]]);
  });

  it('isRef is per-clause — flipping the middle one moves only its opcode', () => {
    const clauses = (mid: boolean) => [
      tryCatch(varName('$e'), makeNop()),
      { tag: varName('$e'), isRef: mid, body: asRegion(makeI32Const(1)) },
      tryCatchAll(makeNop()),
    ];
    const diff = byteDiff(
      encodeWasm(tryModule(clauses(false))),
      encodeWasm(tryModule(clauses(true))),
    );
    assertEquals(diff.length, 1, 'a per-clause flag must not disturb its neighbours');
    assertEquals([diff[0]![1], diff[0]![2]], [0x07, 0x08]);
  });
});
