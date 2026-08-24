// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// `(assert_trap (module …) "msg")` was reported as `assert_invalid`.
//
// The two assertions say opposite things about the module:
//
//   assert_invalid      the module must FAIL VALIDATION
//   assert_trap (module) the module is well-formed and VALID; INSTANTIATING it
//                        traps — an out-of-bounds data or elem segment, or a
//                        start function that traps
//
// So every one of these told a script runner to test the wrong property. 54
// commands were affected across data.wast, data1.wast, elem.wast, linking*.wast
// and start.wast.
//
// It also corrupted a headline conformance number. The `assert_invalid` metric
// asks "modules the spec calls invalid that we reject", and 54 VALID modules
// were being counted into its denominator — modules we correctly accept, and
// which therefore scored as misses:
//
//   before   correctly rejected 2664 / 2737, MISSED 73
//   after    correctly rejected 2664 / 2683, MISSED 19
//
// The claim carried in CLAUDE.md and the README — "all 73 remaining are ones
// V8 accepts too" — was true but measured over a polluted population. Re-checked
// after the fix: all 19 real ones are still V8-accepted, so the conclusion holds
// and the number is now honest.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript } from '../../src/parser/wast-parser.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

function commands(script: string) {
  const { script: s, errors } = parseWastScript(script);
  assert(!hasErrors(errors), formatErrors(errors));
  return s.commands;
}

describe('assert_trap distinguishes its module form from assert_invalid', () => {
  it('reports the MODULE form as assert_trap_module', () => {
    const cmds = commands(
      '(assert_trap (module (memory 1) (data (i32.const 0x10000) "a")) "out of bounds")',
    );
    assertEquals(cmds.map((c) => c.kind), ['assert_trap_module']);
    const c = cmds[0] as unknown as { text: string; scriptModule: { kind: string } };
    assertEquals(c.text, 'out of bounds');
    assertEquals(c.scriptModule.kind, 'text');
  });

  it('still reports the ACTION form as assert_trap', () => {
    const cmds = commands(`
      (module (func (export "f") unreachable))
      (assert_trap (invoke "f") "unreachable")`);
    assertEquals(cmds.map((c) => c.kind), ['module', 'assert_trap']);
    const c = cmds[1] as unknown as { action: { kind: string; field: string } };
    assertEquals(c.action.kind, 'invoke');
    assertEquals(c.action.field, 'f');
  });

  it('leaves a real assert_invalid alone', () => {
    const cmds = commands('(assert_invalid (module (func (result i32))) "type mismatch")');
    assertEquals(cmds.map((c) => c.kind), ['assert_invalid']);
  });

  it('does not put a VALID module into the assert_invalid population', () => {
    // The metric bug in miniature: this module validates fine and only traps
    // at instantiation, so counting it as assert_invalid scores a correct
    // acceptance as a miss.
    const cmds = commands(
      '(assert_trap (module (table 1 funcref) (elem (i32.const 1) $f) (func $f)) "out of bounds")',
    );
    assertEquals(cmds[0]!.kind, 'assert_trap_module');
    assert(cmds.every((c) => c.kind !== 'assert_invalid'));
  });

  it('handles the start-function trap shape', () => {
    const cmds = commands(
      '(assert_trap (module (func $f unreachable) (start $f)) "unreachable")',
    );
    assertEquals(cmds.map((c) => c.kind), ['assert_trap_module']);
  });
});
