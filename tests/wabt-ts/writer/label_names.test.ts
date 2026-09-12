// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The block/label family (S6): a branch whose TARGET LABEL has a name is
// printed by that name — `br $outer`, not `br 1 (;@1;)`.
//
// 🔧 A binary holds only a DEPTH, so every branch read from one is an index.
// N2 gives the target block its name back from the `name` section (subsection
// 3), and we were printing `block $outer` two lines above `br 1` — the name was
// right there and unused. `wasm-tools print` uses it; upstream `wasm2wat` prints
// `br 1 (;@1;)` because it does not read label names at all.
//
// ⚠️ The rule is NOT "always prefer the name": a nearer label with the same name
// captures the reference, so `(block $b (block $b (br 1)))` must keep the depth
// — printing `$b` there would retarget the branch to the inner block.
//
// ⚠️ It applies ONLY where the index is a depth with no spelling behind it,
// which only the CALLER knows: `wasm2wat` decoded a binary and opts in
// (`namedLabelTargets`), while a caller that PARSED text does not — there an
// index is what the author wrote. That was N8's open residual, and it was live
// in the public compat API (`parseWat(…).toText()`, text → IR → text with no
// binary hop), which turned `(block $b (br 0))` into `(br $b)`.
//
// 🔑 That consequence is NOT what moved the corpus. Its 415 text hashes (and 0
// byte hashes) are ALL the binary-derived case, because the baseline's text
// columns come from `wasm2wat(binary)` — a depth with no spelling behind it,
// which is exactly what this rule is for.
//
// An index-form `Var` on a branch target used to mean THREE things — the author
// wrote a number, `resolveNames` resolved a name down to a depth, or a binary
// gave a depth. `resolveNames` no longer rewrites labels (see below), so the
// middle one is gone and a name now reaches the writer as a name. The two that
// remain, an authored number and a binary's depth, are still indistinguishable,
// which is why an authored `br 0` at a named block still prints `$b`. Closing
// that needs an origin marker, and is only worth adding for a text→text
// consumer; there is none today.

import { describe, it } from '@std/testing/bdd';
import { assert, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { writeBinaryIr } from '../../../src/wabt-ts/writer/binary-writer.ts';
import { writeWatModule } from '../../../src/wabt-ts/writer/wat-writer.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}
/** `wasm2wat` of the assembled text, whitespace flattened. */
function roundTrip(wat: string): string {
  return wasm2wat(assemble(wat)).text.replace(/\s+/g, ' ').trim();
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

describe('a named branch target is printed by name', () => {
  it('br to a named outer block', () => {
    const text = roundTrip('(module (func $f (block $outer (block $inner (br $outer)))))');
    assert(text.includes('(br $outer)'), text);
    assert(!text.includes('br 1'), text);
  });

  it('br_if and br_table too', () => {
    const brIf = roundTrip('(module (func $f (block $b (br_if $b (i32.const 1)))))');
    assert(brIf.includes('(br_if $b'), brIf);
    const brTable = roundTrip(
      '(module (func $f (block $a (block $b (br_table $a $b $a (i32.const 0))))))',
    );
    assert(brTable.includes('$a $b $a') || brTable.includes('$a $b $a)'), brTable);
  });

  it('the text re-assembles to the SAME bytes — the name resolves to that depth', () => {
    const wat = '(module (func $f (block $outer (block $inner (br $outer)))))';
    const first = assemble(wat);
    assert(same(assemble(roundTrip(wat)), first), roundTrip(wat));
  });

  it("and the round trip now reconstitutes the source's own spelling", () => {
    // N1's rule, one hop further: the source said `br $outer`, and so does the
    // output. It said `br 1 (;@1;)` before.
    const text = roundTrip('(module (func $f (block $outer (block $inner (br $outer)))))');
    assert(text.includes('block $outer') && text.includes('(br $outer)'), text);
  });
});

describe('…except where the name would mean a different block', () => {
  it('a nearer label with the SAME name keeps the depth', () => {
    // `$b` here resolves to the INNER block, so the outer one cannot be named.
    const text = roundTrip('(module (func $f (block $b (block $b (br 1)))))');
    assert(text.includes('br 1'), text);
  });

  it('and that text still re-assembles to the same bytes', () => {
    const wat = '(module (func $f (block $b (block $b (br 1)))))';
    assert(same(assemble(roundTrip(wat)), assemble(wat)), roundTrip(wat));
  });

  it('an inner branch to the INNER same-named block prints the name', () => {
    const text = roundTrip('(module (func $f (block $b (block $b (br 0)))))');
    assert(text.includes('(br $b)'), text);
  });

  it('an unnamed target keeps the depth and its `(;@N;)` comment', () => {
    const text = roundTrip('(module (func $f (block (block (br 1)))))');
    assert(text.includes('br 1 (;@1;)'), text);
  });
});

describe('the binary writer resolves label NAMES itself', () => {
  // `resolveNames` no longer rewrites a label reference to a depth: a label's
  // target is a position on the block stack the writer already walks, not an
  // entry in a module-level index space. So the writer resolves it, and the
  // as-written spelling stays on the node.
  it('a module whose labels are still names encodes without a resolve pass', () => {
    const { module, errors } = parseWatModule('(module (func (block $b (br $b))))');
    assert(!hasErrors(errors), formatErrors(errors));
    // NOTE: no `resolveNames` call — this threw "unresolved name-var" before.
    const bytes = writeBinaryIr(module);
    assert(WebAssembly.validate(bytes as BufferSource), hex(bytes));
  });

  it('and it resolves to the same depth the resolver would have', () => {
    const viaWriter = (() => {
      const { module } = parseWatModule('(module (func (block $o (block $i (br $o)))))');
      return writeBinaryIr(module);
    })();
    // `br $o` from one block deeper is depth 1.
    assert(hex(viaWriter).includes('0c 01'), hex(viaWriter));
  });

  it('an undefined label name fails LOUD rather than encoding a wrong depth', () => {
    const { module } = parseWatModule('(module (func (block $b (br $nope))))');
    assertThrows(() => writeBinaryIr(module), Error, 'undefined label');
  });

  it("a legacy `delegate` resolves OUTSIDE the try's own label", () => {
    // `(block $b (try (do) (delegate $b)))` — when the delegate target is
    // resolved, the try's own (unnamed) label must be off the stack, so `$b` is
    // depth 0. With it left on, `$b` resolves to depth 1: valid bytes, wrong
    // handler. The parser already rejects `(try $t … (delegate $t))` for the
    // same reason (label_scope.test.ts); this is the writer's half.
    const { module, errors } = parseWatModule(
      '(module (func (block $b (try (do) (delegate $b)))))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    const bytes = writeBinaryIr(module);
    // 0x18 = delegate, then the depth.
    assert(hex(bytes).includes('18 00'), hex(bytes));
  });

  it('a try_table catch resolves outside ITS own label too', () => {
    const { module, errors } = parseWatModule(
      '(module (func (block $h (try_table (catch_all $h) (nop)))))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    // catch_all = 0x02, then the depth: `$h` is the immediately enclosing
    // block, depth 0, because the try_table's own label is not in scope for it.
    // (The four kinds are catch 0x00, catch_ref 0x01, catch_all 0x02,
    // catch_all_ref 0x03.)
    assert(hex(writeBinaryIr(module)).includes('02 00'), hex(writeBinaryIr(module)));
  });

  it('a name shadowed by a nearer one resolves to the NEARER block', () => {
    const { module } = parseWatModule('(module (func (block $b (block $b (br $b)))))');
    // depth 0 — the inner `$b`, which is what the text means.
    assert(hex(writeBinaryIr(module)).includes('0c 00'), hex(writeBinaryIr(module)));
  });
});

describe('text → text keeps the spelling the AUTHOR wrote', () => {
  // The residual N8 left, closed: only the caller knows whether an index-form
  // target carries a spelling. `wasm2wat` decoded a binary, where the format
  // has only depths, so it opts into names (`namedLabelTargets`). A caller that
  // PARSED text must not — there an index is what the author typed, and the
  // compat API's `toText()` is exactly that path, with no binary hop.
  const textToText = (wat: string): string => {
    const { module, errors } = parseWatModule(wat);
    assert(!hasErrors(errors), formatErrors(errors));
    return writeWatModule(module, {}).replace(/\s+/g, ' ').trim();
  };

  it('an authored numeric target at a NAMED block stays numeric', () => {
    const text = textToText('(module (func (block $b (br 0))))');
    assert(text.includes('br 0'), text);
    assert(!text.includes('(br $b)'), text);
  });

  it('an authored NAME still prints as that name', () => {
    assert(textToText('(module (func (block $b (br $b))))').includes('(br $b)'));
  });

  it('br_table keeps each target as written', () => {
    const text = textToText('(module (func (block $a (block $b (br_table 0 $a (i32.const 0))))))');
    assert(text.includes('br_table 0'), text);
    assert(text.includes('$a'), text);
  });

  it('…while wasm2wat, which decoded a binary, still prints the name', () => {
    // Same module through the binary: there the index is a DEPTH, not a
    // spelling, so N8's rule applies and the name is the better text.
    assert(roundTrip('(module (func (block $b (br 0))))').includes('(br $b)'));
  });
});

describe('the label a function frame introduces', () => {
  it('a branch to the function frame is still a depth when it has no name', () => {
    const text = roundTrip('(module (func $f (br 0)))');
    assert(text.includes('br 0'), text);
  });

  it('a loop is named like a block', () => {
    const text = roundTrip('(module (func $f (loop $l (br $l))))');
    assert(text.includes('(br $l)'), text);
  });
});
