// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5: a label reference is a `Var`, on both sides.
//
// binaryen-ts held label references as strings; wabt-ts holds `Var`s. Both
// conditions bind, and a `Var` satisfies both:
//
// - FIDELITY: `br 0` and `br $l` are different text. A string cannot hold an
//   authored depth on an unnamed block; a `Var` holds either.
// - OPTIMIZATION: a depth silently RETARGETS when a pass inserts or removes a
//   block, so a pass must see names. A name-form `Var` is a name.
//
// The invariant that joins them: label references are NAME-form whenever a pass
// reads them. The factories only build names, the decoder names every label,
// and `labelName` throws on a depth rather than guessing. The encoder, which
// inserts nothing, may write a depth as written.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import {
  asRegion,
  type BreakExpr,
  ExpressionKind,
  labelName,
  makeBlock,
  makeBreak,
  makeNop,
  makeRethrow,
  makeSwitch,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import { parseWasm } from '../../../src/binaryen-ts/binary/wasm-parser.ts';
import { ModuleBuilder } from '../../../src/binaryen-ts/ir/module.ts';
import { walkExpression } from '../../../src/binaryen-ts/ir/walk.ts';
import { varIndex, varName } from '../../../src/wabt-ts/ir/ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

describe('label references are Vars, and a pass only ever sees names', () => {
  it('the factories build NAME-form label references', () => {
    assertEquals(makeBreak('$out').target, varName('$out'));
    const sw = makeSwitch(['$a', '$b'], '$c', makeNop());
    assertEquals(sw.targets, [varName('$a'), varName('$b')]);
    assertEquals(sw.defaultTarget, varName('$c'));
    assertEquals(makeRethrow('$t').target, varName('$t'));
  });

  it('a decoded branch target is name-form -- even where the binary held only a depth', () => {
    const bytes = wat2wasm(`(module (func (block (block (br 1)))))`).binary;
    const kinds: string[] = [];
    walkExpression(parseWasm(bytes).functions[0]!.body, (e) => {
      if (e.kind === ExpressionKind.Break) kinds.push((e as BreakExpr).target.kind);
    });
    assertEquals(kinds, ['name']);
  });

  it('labelName refuses a depth: a pass must not guess what a shifted index meant', () => {
    assertEquals(labelName(varName('$l')), '$l');
    assertThrows(() => labelName(varIndex(0)), Error, 'label reference');
  });

  it('the encoder writes an index-form label as the depth it is', () => {
    // Same function twice: `br $outer` by name, and `br 1` by depth.
    const build = (target: 'name' | 'depth') => {
      const m = new ModuleBuilder();
      const br = makeBreak('$outer');
      const node = target === 'name' ? br : { ...br, target: varIndex(1) };
      m.addFunction(
        'f',
        [],
        [],
        makeBlock([makeBlock([node], '$inner')], '$outer'),
      );
      return encodeWasm(m.build());
    };
    const byName = build('name');
    assert(WebAssembly.validate(byName as BufferSource));
    assertEquals(build('depth'), byName);
  });

  it('and refuses a depth deeper than the labels that enclose it', () => {
    const m = new ModuleBuilder();
    m.addFunction('f', [], [], asRegion([{ ...makeBreak('$x'), target: varIndex(9) }]));
    assertThrows(() => encodeWasm(m.build()), Error, 'outside');
  });
});
