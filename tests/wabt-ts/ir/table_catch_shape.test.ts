// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `TableCatch` is TWO SHAPES, not one interface with an optional tag.
//
// 🔧 It was `{ kind: CatchKind; tag?: Var; target: Var }`, and `kind` and the
// presence of `tag` are the same fact: `catch` / `catch_ref` name a tag,
// `catch_all` / `catch_all_ref` cannot. Held that way the pair could disagree —
// and the binary writer reads them SEPARATELY:
//
//     this.s.writeU8(catchKindByte(c.kind));
//     if (c.tag !== undefined) writeVar(this.s, c.tag);
//
// so a `CatchAll` carrying a tag would emit the `catch_all` byte FOLLOWED by a
// stray tag index, sliding every later clause's fields by one. Valid-looking
// bytes, a different program, no diagnostic — the silent-corruption shape this
// codebase keeps finding, one fact in two places.
//
// Nothing built that state: the parser and reader both set the pair together,
// so this closes the SHAPE rather than a live defect. The split moves the
// guarantee to the compiler, which refuses the combination at every
// construction site — including a spread rebuild, where `resolveNames` used to
// widen it back.
//
// ⚠️ The assertions that matter here are the `@ts-expect-error` ones: they are
// checked by `deno task check`, so if `TableCatch` is ever widened back into
// one interface they stop erroring and the GATE fails. That is this test's
// inversion — a runtime assertion cannot express "unrepresentable".

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { CatchKind, varIndex } from '../../../src/wabt-ts/ir/ir.ts';
import type { TableCatch } from '../../../src/wabt-ts/ir/ir.ts';
import { unknownLocation } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

const loc = unknownLocation();
const target = varIndex(0);
const tag = varIndex(0);

describe('the compiler refuses a catch clause whose kind and tag disagree', () => {
  it('a tagged kind REQUIRES its tag', () => {
    const ok: TableCatch = { kind: CatchKind.Catch, tag, target, loc };
    assertEquals(ok.tag, tag);

    // @ts-expect-error — `catch` without a tag is not a shape that exists.
    const bad: TableCatch = { kind: CatchKind.Catch, target, loc };
    assert(bad !== undefined);
  });

  it('a catch_all kind cannot CARRY a tag', () => {
    const ok: TableCatch = { kind: CatchKind.CatchAll, target, loc };
    assertEquals(ok.tag, undefined);

    // @ts-expect-error — this is the combination that wrote `catch_all` and
    // then a stray tag index.
    const bad: TableCatch = { kind: CatchKind.CatchAll, tag, target, loc };
    assert(bad !== undefined);
  });

  it('the ref variants follow their tagged / untagged halves', () => {
    const withTag: TableCatch = { kind: CatchKind.CatchRef, tag, target, loc };
    const without: TableCatch = { kind: CatchKind.CatchAllRef, target, loc };
    assertEquals(withTag.tag, tag);
    assertEquals(without.tag, undefined);

    // @ts-expect-error — `catch_all_ref` takes no tag either.
    const bad: TableCatch = { kind: CatchKind.CatchAllRef, tag, target, loc };
    assert(bad !== undefined);
  });

  it('narrowing on `kind` GIVES the tag, with no non-null assertion', () => {
    // What the bridge's `buildCatchClause` relies on: the switch narrows, so
    // the tagged arms see a `Var` rather than `Var | undefined`.
    const clauses: TableCatch[] = [
      { kind: CatchKind.Catch, tag, target, loc },
      { kind: CatchKind.CatchAll, target, loc },
    ];
    const seen: string[] = [];
    for (const c of clauses) {
      switch (c.kind) {
        case CatchKind.Catch:
        case CatchKind.CatchRef:
          seen.push(`tagged:${c.tag.kind}`); // `c.tag` is a Var here, not optional
          break;
        case CatchKind.CatchAll:
        case CatchKind.CatchAllRef:
          seen.push('all');
          break;
      }
    }
    assertEquals(seen, ['tagged:index', 'all']);
  });
});

describe('and all four clause shapes still encode correctly', () => {
  function codeOf(wat: string): string {
    const r = wat2wasm(wat);
    if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
    const b = r.binary;
    for (let i = 8; i < b.length;) {
      const id = b[i++]!;
      let size = 0;
      for (let s = 0;; s += 7) {
        const x = b[i++]!;
        size += (x & 0x7f) * 2 ** s;
        if ((x & 0x80) === 0) break;
      }
      if (id === 10) {
        return [...b.subarray(i, i + size)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
      }
      i += size;
    }
    return '(none)';
  }

  // The kind byte, then a tag index only for the TAGGED pair:
  // catch 0x00, catch_ref 0x01, catch_all 0x02, catch_all_ref 0x03. The
  // `_ref` variants hand the handler an `exnref`, so their target block takes
  // one as a result.
  for (
    const [name, wat, expect] of [
      [
        'catch',
        '(module (tag $e) (func (block $h (try_table (catch $e $h) (nop)))))',
        '00 00 00',
      ],
      [
        'catch_all',
        '(module (tag $e) (func (block $h (try_table (catch_all $h) (nop)))))',
        '02 00',
      ],
      [
        'catch_ref',
        '(module (tag $e) (func (block $h (result exnref)' +
        ' (try_table (catch_ref $e $h) (nop)) (unreachable)) (drop)))',
        '01 00 00',
      ],
      [
        'catch_all_ref',
        '(module (tag $e) (func (block $h (result exnref)' +
        ' (try_table (catch_all_ref $h) (nop)) (unreachable)) (drop)))',
        '03 00',
      ],
    ] as const
  ) {
    it(name, () => {
      const code = codeOf(wat);
      assert(code.includes(expect), `${name}: ${code}`);
    });
  }
});
