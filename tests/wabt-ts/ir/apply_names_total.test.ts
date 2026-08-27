// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.20 — `applyNames` walked 37 of 87 expression kinds.
//
// It is `resolveNames`'s sibling: same two axes, opposite direction. Every
// `Expr`-typed field must be recursed into, and every `Var`-typed field naming
// a module-level entity must be rewritten. `resolveNames` is total on both —
// it was made total by Bug G, the atomic `memidx` gap and T13.11, one painful
// case at a time. Nobody had ever run the same enumeration against `applyNames`,
// and it had **50 kinds falling to `default: return e`**.
//
// The symptom is not a crash or invalid output; it is silent INCONSISTENCY. A
// `global.get` at statement position was named while the identical reference
// nested inside `memory.fill`'s operands kept its numeric index:
//
//     global.set $myglobal        <- handled kind
//     global.get 0                <- inside memory.fill, unhandled
//
// `applyNames` is published from `src/index.ts` but used by no internal
// pipeline (`wasm2wat` and `/compat` both call `generateNames`), which is
// exactly why no corpus, metric or test caught it — and why the recurrence
// table's "a helper that exists and is never called" row is where it was found.
//
// The fix makes axis 1 GENERIC — it cannot miss a kind by construction — and
// leaves axis 2 an explicit table, because which name space a var belongs to is
// per-kind knowledge that cannot be read off the field name (`segment` is a
// data index on `memory.init` and an elem index on `table.init`). This file
// gates both halves.

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { LexerSource } from '../../src/parser/lexer-source.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { applyNames, makeModuleNames } from '../../src/ir/apply-names.ts';
import { writeWatModule } from '../../src/writer/wat-writer.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** Parse + resolve, then apply the supplied names and print the result. */
function named(wat: string, fill: (n: ReturnType<typeof makeModuleNames>) => void): string {
  const { module, errors } = parseWatModule(new LexerSource(wat, 't.wat'));
  if (hasErrors(errors)) throw new Error('parse:\n' + formatErrors(errors));
  resolveNames(module, errors);
  if (hasErrors(errors)) throw new Error('resolveNames:\n' + formatErrors(errors));
  const names = makeModuleNames();
  fill(names);
  applyNames(module, names);
  return writeWatModule(module);
}

describe('T13.20 — axis 1: every nested sub-expression is walked', () => {
  // Each case puts the SAME `global.get 0` inside a different parent, so a
  // parent that does not recurse shows up as a numeric index. The parents are
  // drawn from the 50 kinds that used to fall through.
  const NESTERS: [string, string][] = [
    ['memory.fill', '(memory.fill (global.get $g) (i32.const 0) (i32.const 1))'],
    ['memory.copy', '(memory.copy (global.get $g) (i32.const 0) (i32.const 1))'],
    ['memory.init', '(memory.init $d (global.get $g) (i32.const 0) (i32.const 0))'],
    ['table.copy', '(table.copy (global.get $g) (i32.const 0) (i32.const 0))'],
    ['table.init', '(table.init $e (global.get $g) (i32.const 0) (i32.const 0))'],
    ['ref.is_null', '(drop (ref.is_null (ref.null func)))(drop (global.get $g))'],
    ['select', '(drop (select (global.get $g) (i32.const 1) (i32.const 0)))'],
    ['br_if', '(block (br_if 0 (global.get $g)))'],
    ['br_table', '(block (br_table 0 0 (global.get $g)))'],
    ['try body', '(try (do (drop (global.get $g))))'],
    ['block', '(block (drop (global.get $g)))'],
    ['loop', '(loop (drop (global.get $g)))'],
    ['if cond', '(if (global.get $g) (then (nop)))'],
  ];

  for (const [name, body] of NESTERS) {
    it(`names a global referenced inside ${name}`, () => {
      const text = named(
        `(module
           (memory 1) (table 4 funcref) (func $t) (data $d "xy") (elem $e func $t)
           (global $g (mut i32) (i32.const 0))
           (func $f ${body}))`,
        (n) => n.globalNames.set(0, '$named'),
      );
      assert(
        !/global\.(get|set)\s+0\b/.test(text),
        `a global reference inside ${name} kept its numeric index:\n${text}`,
      );
      assert(/global\.get \$named/.test(text), `no named global.get emitted:\n${text}`);
    });
  }
});

describe('T13.20 — axis 2: module-level Var immediates are rewritten', () => {
  it('names the data segment of memory.init and data.drop', () => {
    const text = named(
      `(module (memory 1) (data "xy")
         (func (memory.init 0 (i32.const 0) (i32.const 0) (i32.const 0)) (data.drop 0)))`,
      (n) => n.dataSegmentNames.set(0, '$seg'),
    );
    assert(/memory\.init \$seg/.test(text), `memory.init segment not named:\n${text}`);
    assert(/data\.drop \$seg/.test(text), `data.drop segment not named:\n${text}`);
  });

  it('names the elem segment of table.init and elem.drop', () => {
    const text = named(
      `(module (table 4 funcref) (func $t) (elem func $t)
         (func (table.init 0 (i32.const 0) (i32.const 0) (i32.const 0)) (elem.drop 0)))`,
      (n) => n.elemSegmentNames.set(0, '$es'),
    );
    assert(/table\.init .*\$es/.test(text), `table.init segment not named:\n${text}`);
    assert(/elem\.drop \$es/.test(text), `elem.drop segment not named:\n${text}`);
  });

  it('does NOT confuse the two segment index spaces', () => {
    // `segment` is a DATA index on memory.init and an ELEM index on
    // table.init. A field-name-keyed rewrite would rename one through the
    // other's map — Bug G's failure mode, silently pointing at a real but
    // wrong entity.
    const text = named(
      `(module (memory 1) (table 4 funcref) (func $t) (data "xy") (elem func $t)
         (func (memory.init 0 (i32.const 0) (i32.const 0) (i32.const 0))
               (table.init 0 (i32.const 0) (i32.const 0) (i32.const 0))))`,
      (n) => {
        n.dataSegmentNames.set(0, '$DATA');
        n.elemSegmentNames.set(0, '$ELEM');
      },
    );
    assert(/memory\.init \$DATA/.test(text), `memory.init took the wrong map:\n${text}`);
    assert(/table\.init .*\$ELEM/.test(text), `table.init took the wrong map:\n${text}`);
    assert(!/memory\.init \$ELEM/.test(text), `memory.init got the ELEM name:\n${text}`);
    assert(!/table\.init .*\$DATA/.test(text), `table.init got the DATA name:\n${text}`);
  });

  it('names the tag of a throw', () => {
    const text = named(
      '(module (tag (param i32)) (func (throw 0 (i32.const 1))))',
      (n) => n.tagNames.set(0, '$exc'),
    );
    assert(/throw \$exc/.test(text), `throw tag not named:\n${text}`);
  });

  it('names the type of a call_indirect', () => {
    const text = named(
      `(module (type (func)) (table 1 funcref)
         (func (call_indirect (type 0) (i32.const 0))))`,
      (n) => n.typeNames.set(0, '$sig'),
    );
    assert(/\$sig/.test(text), `call_indirect typeVar not named:\n${text}`);
  });
});

describe('T13.20 — the deliberate exceptions stay exceptions', () => {
  it('never rewrites a LOCAL index through the function-name map', () => {
    // The pass has had this bug once already: a local index that collided with
    // a named function index was silently renamed to that function.
    const text = named(
      '(module (func $a) (func $b (param i32) (result i32) (local.get 0)))',
      (n) => {
        n.funcNames.set(0, '$FUNC_ZERO');
        n.funcNames.set(1, '$FUNC_ONE');
      },
    );
    assert(/local\.get 0/.test(text), `local.get was rewritten:\n${text}`);
    assert(!/local\.get \$FUNC/.test(text), `local.get took a function name:\n${text}`);
  });

  it('never rewrites a branch LABEL through a module-level map', () => {
    // `labelNames` is per-function and this pass has no function context, so
    // renaming a label here would be a guess dressed as a fact.
    const text = named(
      '(module (func $a) (func (block (br 0))))',
      (n) => {
        n.funcNames.set(0, '$FUNC_ZERO');
        n.typeNames.set(0, '$TYPE_ZERO');
        n.globalNames.set(0, '$GLOBAL_ZERO');
      },
    );
    assert(
      !/br \$FUNC_ZERO|br \$TYPE_ZERO|br \$GLOBAL_ZERO/.test(text),
      `br took a name:\n${text}`,
    );
  });

  it('leaves an abstract heap-type keyword alone', () => {
    // `ref.null func` carries a NAME-form var holding a keyword, not a type
    // index. rewriteVar only touches index-form vars, which is what keeps this
    // from becoming `ref.null $sometype`.
    const text = named(
      '(module (type (func)) (func (result funcref) (ref.null func)))',
      (n) => n.typeNames.set(0, '$sig'),
    );
    assert(/ref\.null func/.test(text), `abstract heap type was rewritten:\n${text}`);
  });
});
