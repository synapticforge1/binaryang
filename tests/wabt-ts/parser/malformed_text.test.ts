// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Text the PARSER must reject — `assert_malformed`'s meaning. Both families
// here were reported by the wasmtk team (2026-09-19) after they split their
// .wast runner's stages: a single catch around "assemble the module" had let an
// ENCODER error satisfy an assertion that means "this text cannot be decoded".
//
//   ① a limit's integer literal took no range check, while an instruction
//      operand does — `(memory i64 0x1_0000_0000_0000_0000)` parsed and failed
//      in the writer with "u64 LEB128 out of range";
//   ② a legacy `try`'s clause structure was unchecked — arity, ordering and the
//      mandatory `do`. Two of those shapes assembled into modules that RUN.
//
// Upstream wabt 1.0.41 and wasm-tools 1.259.0 were the oracles for every row.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';

/** The first parse diagnostic for `wat`, or null when it parses. */
function parseError(wat: string): string | null {
  const r = parseWatModule(wat);
  return r.errors.length > 0 ? r.errors[0]!.message : null;
}
const assertRejected = (wat: string, expect: RegExp) => {
  const e = parseError(wat);
  assert(e !== null, `expected a parse error for:\n${wat}`);
  assert(expect.test(e), `expected ${expect} for:\n${wat}\ngot: ${e}`);
};
const assertParses = (wat: string) => assertEquals(parseError(wat), null, wat);

describe('malformed text — a limit is a u64', () => {
  it('2^64 and above is out of range, wherever a limit is spelled', () => {
    const tooBig = '0x1_0000_0000_0000_0000';
    for (
      const wat of [
        `(module (memory i64 ${tooBig} (pagesize 1)))`,
        `(module (memory i64 0 ${tooBig} (pagesize 1)))`,
        `(module (memory ${tooBig}))`,
        `(module (table i64 ${tooBig} funcref))`,
        `(module (import "m" "t" (table i64 ${tooBig} funcref)))`,
        '(module (memory i64 0x1_0000_0000_0000_0000_0000 (pagesize 1)))', // 2^80
      ]
    ) assertRejected(wat, /i64 constant out of range/);
  });

  it('2^64 − 1 is in range: the boundary parses', () => {
    assertParses('(module (memory i64 0xFFFF_FFFF_FFFF_FFFF (pagesize 1)))');
    assertParses('(module (table i64 0xFFFF_FFFF_FFFF_FFFF funcref))');
  });

  // ⚠️ The case that looks identical and is not. 2^32 is in range for the
  // limit's u64 spelling, so the module is WELL-FORMED and invalid — the
  // validator's business, not the parser's. wasm-tools agrees; upstream wabt
  // calls it malformed. Rejecting it here would re-break what the wasmrt team
  // fixed in `proposals/threads/memory.wast`, where "i32 constant out of range"
  // was the stale expectation.
  it('2^32 on a 32-bit memory still PARSES — well-formed, invalid', () => {
    assertParses('(module (memory 0x1_0000_0000))');
    assertParses('(module (table 0x1_0000_0000 funcref))');
  });

  it('an instruction operand is still checked, as it always was', () => {
    assertRejected(
      '(module (func (result i32) (i32.const 0x1_0000_0000)))',
      /i32 constant out of range/,
    );
    assertRejected(
      '(module (func (result i64) (i64.const 0x1_0000_0000_0000_0000)))',
      /i64 constant out of range/,
    );
  });
});

describe("malformed text — a legacy try's clauses", () => {
  it('needs a `do`, first', () => {
    assertRejected('(module (func (try (catch_all))))', /expected \(do/);
    assertRejected('(module (func (try (nop) (catch_all))))', /expected \(do/);
    assertRejected('(module (tag $e) (func (try (catch $e) (do))))', /expected \(do/);
  });

  it('takes only one `do`', () => {
    assertRejected('(module (func (try (do) (do) (catch_all))))', /multiple do clauses/);
  });

  it('takes only one `catch_all`, folded or linear', () => {
    assertRejected(
      '(module (func (try (do) (catch_all) (catch_all))))',
      /multiple catch_all clauses/,
    );
    assertRejected(
      '(module (func try nop catch_all nop catch_all nop end))',
      /multiple catch_all clauses/,
    );
  });

  it('takes a `delegate` INSTEAD of handlers, not after them', () => {
    assertRejected(
      '(module (func (try (do) (catch_all) (delegate 0))))',
      /delegate cannot follow a catch clause/,
    );
    assertRejected(
      '(module (func try nop catch_all nop delegate 0))',
      /delegate cannot follow a catch clause/,
    );
  });

  it('the legal shapes still parse', () => {
    for (
      const wat of [
        '(module (func (try (do))))',
        '(module (func (try (do) (catch_all))))',
        '(module (tag $e) (func (try (do) (catch $e))))',
        '(module (tag $e) (func (try (do) (catch $e) (catch_all))))',
        '(module (tag $e) (tag $f) (func (try (do) (catch $e) (catch $f))))',
        '(module (func (try (do) (delegate 0))))',
        '(module (func (try $t (result i32) (do (i32.const 1)) (catch_all (i32.const 2)))))',
        '(module (tag $e) (func try nop catch $e nop catch_all nop end))',
        '(module (func try nop delegate 0))',
      ]
    ) assertParses(wat);
  });

  // The ordering rule is the ENGINE's: upstream wabt parses this text and V8
  // rejects the module ("catch after catch-all"). Malformed and invalid are
  // different verdicts, and this one is invalid — our validator does not catch
  // it yet (recorded in cmem/open-work.md).
  it('a `catch` after `catch_all` parses — invalid, not malformed', () => {
    assertParses('(module (tag $e) (func (try (do) (catch_all) (catch $e))))');
    assertParses('(module (tag $e) (func try nop catch_all nop catch $e nop end))');
  });
});
