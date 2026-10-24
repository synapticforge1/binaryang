// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 38: the interpreter runs a shared memory and the atomics, single-threaded. Every atomic
// instruction and its out-of-bounds / misaligned traps were checked against the outcome every
// defining engine agreed on (179 / 179 probe modules, cmem/portability.md). These are the cases the
// probes do not reach, each with wasmtime 50's result (measured 2026-10-24) and the threads
// proposal's rule (proposals/threads/Overview.md): the ORDER of the checks (misaligned, then out of
// bounds, then — for wait — unshared), wait and notify, and the wait no single thread can end.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { allFeatures } from '../../../src/core/feature.ts';
import { interpModule } from '../../../src/tools/wasm-interp.ts';

const SHARED = `(module (memory 1 1 shared)
  (func (export "misaligned_and_oob") (result i32) (i32.atomic.load (i32.const 65537)))
  (func (export "oob") (result i32) (i32.atomic.load (i32.const 65536)))
  (func (export "misaligned_by_offset") (result i32) (i32.atomic.load offset=2 (i32.const 0)))
  (func (export "wait_equal_timeout_0") (result i32) (memory.atomic.wait32 (i32.const 0) (i32.const 0) (i64.const 0)))
  (func (export "wait_differs") (result i32) (memory.atomic.wait32 (i32.const 0) (i32.const 5) (i64.const -1)))
  (func (export "wait64_differs") (result i32) (memory.atomic.wait64 (i32.const 8) (i64.const 1) (i64.const -1)))
  (func (export "wait_forever") (result i32) (memory.atomic.wait32 (i32.const 0) (i32.const 0) (i64.const -1)))
  (func (export "notify") (result i32) (memory.atomic.notify (i32.const 0) (i32.const 3)))
  (func (export "notify_misaligned") (result i32) (memory.atomic.notify (i32.const 2) (i32.const 1)))
  (func (export "wait64_misaligned") (result i32) (memory.atomic.wait64 (i32.const 4) (i64.const 0) (i64.const 0)))
  (func (export "fence") (result i32) (atomic.fence) (i32.const 9))
  (func (export "rmw8_wraps") (result i32)
    (i32.atomic.store8 (i32.const 16) (i32.const 250))
    (drop (i32.atomic.rmw8.add_u (i32.const 16) (i32.const 10)))
    (i32.atomic.load8_u (i32.const 16)))
  (func (export "cmpxchg_compares_at_width") (result i64)
    (i64.atomic.store16 (i32.const 24) (i64.const 0x1234))
    ;; expected 0xFFFF_1234 wraps to 0x1234 at 16 bits: equal, so 0x5678 is stored; the old value returns
    (drop (i64.atomic.rmw16.cmpxchg_u (i32.const 24) (i64.const 0xffff1234) (i64.const 0x5678)))
    (i64.atomic.load16_u (i32.const 24)))
  (func (export "rmw_returns_old") (result i32)
    (i32.atomic.store (i32.const 40) (i32.const 5))
    (i32.atomic.rmw.add (i32.const 40) (i32.const 3)))
  (func (export "cmpxchg_unequal_keeps") (result i32)
    (i32.atomic.store (i32.const 32) (i32.const 7))
    (drop (i32.atomic.rmw.cmpxchg (i32.const 32) (i32.const 8) (i32.const 99)))
    (i32.atomic.load (i32.const 32))))`;

const UNSHARED = `(module (memory 1 1)
  (func (export "wait_unshared") (result i32) (memory.atomic.wait32 (i32.const 0) (i32.const 0) (i64.const 0)))
  (func (export "wait_unshared_misaligned") (result i32) (memory.atomic.wait32 (i32.const 1) (i32.const 0) (i64.const 0)))
  (func (export "wait_unshared_oob") (result i32) (memory.atomic.wait32 (i32.const 65536) (i32.const 0) (i64.const 0)))
  (func (export "notify_unshared") (result i32) (memory.atomic.notify (i32.const 0) (i32.const 1)))
  (func (export "rmw_unshared") (result i32) (drop (i32.atomic.rmw.add (i32.const 0) (i32.const 7))) (i32.atomic.load (i32.const 0))))`;

const run = (wat: string, name: string) => {
  const m = readForPasses(wat2wasm(wat, { textForm: false, features: allFeatures() }).binary);
  const [inv] = interpModule(m, { runExport: name, args: [] });
  const o = inv!.outcome;
  if ('values' in o) return o.values.map((v) => String((v as { value: unknown }).value)).join(',');
  if ('trap' in o) return `trap: ${o.trap}`;
  if ('stop' in o) return `stop: ${o.stop}`;
  return `exception: ${o.exception}`;
};

describe('a shared memory runs (it was refused, whatever the code did)', () => {
  const cases: [string, string][] = [
    ['misaligned_and_oob', 'trap: unaligned atomic'], // misaligned first, as wasmtime
    ['oob', 'trap: out of bounds memory access'],
    ['misaligned_by_offset', 'trap: unaligned atomic'], // the EFFECTIVE address
    ['wait_equal_timeout_0', '2'], // "timed-out": no other thread to wake it
    ['wait_differs', '1'], // "not-equal"
    ['wait64_differs', '1'],
    ['notify', '0'], // no waiter to wake
    ['notify_misaligned', 'trap: unaligned atomic'],
    ['wait64_misaligned', 'trap: unaligned atomic'],
    ['fence', '9'],
    ['rmw8_wraps', '4'], // 250 + 10 wraps at 8 bits
    ['cmpxchg_compares_at_width', '22136'], // 0x5678
    ['cmpxchg_unequal_keeps', '7'],
    ['rmw_returns_old', '5'], // the value BEFORE the add (wasmtime: 5)
  ];
  for (const [name, want] of cases) it(name, () => expect(run(SHARED, name)).toBe(want));

  it('a wait no thread can end is reported as a hang, not run forever', () => {
    expect(run(SHARED, 'wait_forever')).toBe(
      'stop: hang: memory.atomic.wait with no timeout: no other thread can wake it',
    );
  });
});

describe('atomics on an UNSHARED memory: only wait traps', () => {
  const cases: [string, string][] = [
    ['wait_unshared', 'trap: atomic wait on non-shared memory'],
    ['wait_unshared_misaligned', 'trap: unaligned atomic'], // misaligned before unshared
    ['wait_unshared_oob', 'trap: out of bounds memory access'], // out of bounds before unshared
    ['notify_unshared', '0'],
    ['rmw_unshared', '7'],
  ];
  for (const [name, want] of cases) it(name, () => expect(run(UNSHARED, name)).toBe(want));
});
