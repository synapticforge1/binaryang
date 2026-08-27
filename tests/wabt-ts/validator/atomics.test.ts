// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.9 - the threads proposal, which no conformance metric has ever seen.
//
// The 257-file spec-testsuite snapshot contains **no atomics at all**: no
// `atomic.wast`, no shared-memory file, and not one `atomic.load` / `store` /
// `rmw` in any file. So the entire threads proposal sits outside the population
// every metric measures - and two real bugs lived there undisturbed:
//
//   T13.8  `instrInputCount` was one too high for atomic store / rmw / cmpxchg,
//          so `wasm2wat` output of any such module was REJECTED BY V8.
//   T13.9  `getOpcodeTypeInfo` had a `PREFIX_MISC` branch and no
//          `PREFIX_THREADS` one, so every atomic fell through to the SIMD
//          default and was type-checked as `(v128, v128) -> v128`. Our
//          validator REJECTED every atomic memory op with
//          "expected [v128] but got [i32]" - a false rejection, the worse
//          class, and the same sibling-case gap the misc comment describes one
//          prefix over.
//
// This test sweeps the whole 0xfe space by asking the printer for each name,
// building a module that uses it, and requiring three things at once: our
// validator agrees with V8, and the module round-trips byte-identically.
// 67 opcodes.
//
// The atomic type table is DERIVED, not written out - the range 0x10-0x4e
// repeats a 7-wide cycle, so one `(sub - 0x10) % 7` covers all sixty-odd. A
// hand-copied table of that size is exactly what drifted for SIMD (see the
// `S()` note in type-checker.ts).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../src/tools/wasm-validate.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { anyOpcodeName, PREFIX_THREADS } from '../../src/core/opcode.ts';
import { formatErrors, hasErrors } from '../../src/core/error.ts';

/** A one-instruction module exercising `name`, or null if it has no shape here. */
function moduleFor(name: string): string | null {
  const T = name.startsWith('i64.') ? 'i64' : 'i32';
  const A = '(i32.const 0)';
  const v = (t: string) => `(${t}.const 0)`;
  let body: string;
  if (name === 'atomic.fence') body = '(atomic.fence)';
  else if (name === 'memory.atomic.notify') body = `(drop (${name} ${A} ${v('i32')}))`;
  else if (name === 'memory.atomic.wait32') body = `(drop (${name} ${A} ${v('i32')} ${v('i64')}))`;
  else if (name === 'memory.atomic.wait64') body = `(drop (${name} ${A} ${v('i64')} ${v('i64')}))`;
  else if (/\.atomic\.load/.test(name)) body = `(drop (${name} ${A}))`;
  else if (/\.atomic\.store/.test(name)) body = `(${name} ${A} ${v(T)})`;
  else if (/cmpxchg/.test(name)) body = `(drop (${name} ${A} ${v(T)} ${v(T)}))`;
  else if (/\.atomic\.rmw/.test(name)) body = `(drop (${name} ${A} ${v(T)}))`;
  else return null;
  return `(module (memory 1 1 shared) (func ${body}))`;
}

function atomicNames(): { name: string; op: number }[] {
  const out: { name: string; op: number }[] = [];
  for (let sub = 0; sub <= 0x4e; sub++) {
    const op = (PREFIX_THREADS << 16) | sub;
    const name = anyOpcodeName(op);
    if (!name.startsWith('<opcode:')) out.push({ name, op });
  }
  return out;
}

describe('T13.9 - every atomic opcode validates, agrees with V8, and round-trips', () => {
  it('sweeps the whole 0xfe space', () => {
    const names = atomicNames();
    // Guard the POPULATION, so a broken sweep fails instead of passing empty.
    assert(names.length >= 67, `only ${names.length} atomic opcodes named - sweep is broken`);

    const problems: string[] = [];
    let checked = 0;
    for (const { name } of names) {
      const src = moduleFor(name);
      if (src === null) continue;
      checked++;
      const r = wat2wasm(src);
      if (hasErrors(r.errors) || !r.binary) {
        problems.push(`${name}: did not encode - ${formatErrors(r.errors).split('\n')[0]}`);
        continue;
      }
      const bin = r.binary;
      const buf = new ArrayBuffer(bin.length);
      new Uint8Array(buf).set(bin);
      const v8 = WebAssembly.validate(buf);
      const ours = wasmValidate(bin, { features: allFeatures() }).result === 0;
      if (v8 !== ours) {
        problems.push(
          `${name}: V8=${v8 ? 'accept' : 'reject'} ours=${ours ? 'accept' : 'REJECT'} - ` +
            formatErrors(wasmValidate(bin, { features: allFeatures() }).errors).split('\n')[0],
        );
        continue;
      }
      const text = wasm2wat(bin).text;
      if (!text) {
        problems.push(`${name}: wasm2wat produced nothing`);
        continue;
      }
      const again = wat2wasm(text);
      if (hasErrors(again.errors) || !again.binary) {
        problems.push(`${name}: re-parse of its own disassembly failed`);
        continue;
      }
      const a = again.binary;
      if (a.length !== bin.length || !a.every((x, i) => x === bin[i])) {
        problems.push(`${name}: round trip changed the bytes`);
      }
    }
    assert(checked >= 67, `only ${checked} atomic opcodes exercised`);
    assertEquals(problems, [], 'atomic opcodes disagreeing with V8 or failing to round-trip');
  });
});

describe('T13.9 - the widths are right, not merely accepted', () => {
  it('rejects an i64 value given to a 32-bit atomic, and vice versa', () => {
    // A `(v128,v128)->v128` fallthrough accepted nothing and rejected
    // everything; a table that is merely PRESENT could still be uniformly
    // wrong. These pin the actual widths.
    const bad = [
      '(module (memory 1 1 shared) (func (i32.atomic.store (i32.const 0) (i64.const 0))))',
      '(module (memory 1 1 shared) (func (i64.atomic.store (i32.const 0) (i32.const 0))))',
      '(module (memory 1 1 shared) (func (result i64) (i32.atomic.load (i32.const 0))))',
      '(module (memory 1 1 shared) (func (result i32) (i64.atomic.load (i32.const 0))))',
      '(module (memory 1 1 shared) (func (drop (memory.atomic.wait32 (i32.const 0) (i64.const 0) (i64.const 0)))))',
    ];
    for (const src of bad) {
      const r = wat2wasm(src);
      if (hasErrors(r.errors)) continue; // rejected earlier, also fine
      assertEquals(
        wasmValidate(r.binary!, { features: allFeatures() }).result !== 0,
        true,
        `accepted a mistyped atomic:\n${src}`,
      );
    }
  });

  it('accepts the correctly-typed counterparts', () => {
    const good = [
      '(module (memory 1 1 shared) (func (i32.atomic.store (i32.const 0) (i32.const 0))))',
      '(module (memory 1 1 shared) (func (i64.atomic.store (i32.const 0) (i64.const 0))))',
      '(module (memory 1 1 shared) (func (result i32) (i32.atomic.load (i32.const 0))))',
      '(module (memory 1 1 shared) (func (result i64) (i64.atomic.load (i32.const 0))))',
      '(module (memory 1 1 shared) (func (result i64) (i64.atomic.rmw8.add_u (i32.const 0) (i64.const 1))))',
    ];
    for (const src of good) {
      const r = wat2wasm(src);
      assert(!hasErrors(r.errors) && r.binary, `${src}\n${formatErrors(r.errors)}`);
      assertEquals(
        wasmValidate(r.binary, { features: allFeatures() }).result,
        0,
        `rejected a well-typed atomic:\n${src}`,
      );
    }
  });
});
