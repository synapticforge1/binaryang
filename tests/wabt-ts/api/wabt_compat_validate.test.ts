// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 52 (b), divergences CL21 and CL24 (2026-10-28) — the wabt.js facade against libwabt.js:
// - `WasmModule.validate()` was missing (a TypeError for code ported from libwabt.js). It throws
//   on an invalid module, an `Error` naming its method (wabt-ts.md's decision for /compat/wabt).
// - `toBinary()` returned `{ buffer }` only; libwabt.js adds `log`, a string.
// - `parseWat`'s feature bag was accepted and IGNORED, so a partial bag equalled `enable_all`. It
//   gates now: upstream's defaults, each key set on or off, all with `enable_all`; a construct of
//   a disabled feature is refused at parse, and nothing else of validation runs there (DG5).

import { describe, it } from 'node:test';
import { assert, assertEquals, assertThrows } from '@std/assert';

import wabt from '../../../src/compat/wabt-compat.ts';

const TAIL = '(module (func $f) (func (return_call $f)))';
const INVALID = '(module (func (result i32)))';

describe('open-work 52 — the wabt facade validates, gates features, returns a log', () => {
  it('validate() throws on an invalid module, naming the method, and passes a valid one', async () => {
    const w = await wabt();
    const bad = w.parseWat('bad.wat', INVALID);
    assertThrows(() => bad.validate(), Error, 'validate: ');
    w.parseWat('ok.wat', '(module (func (result i32) (i32.const 1)))').validate();
  });

  it('parseWat does not validate (DG5): an invalid module still parses', async () => {
    const w = await wabt();
    w.parseWat('bad.wat', INVALID).destroy();
  });

  it('the feature bag gates: off by default, on when asked, on with enable_all', async () => {
    const w = await wabt();
    assertThrows(() => w.parseWat('t.wat', TAIL), Error, 'tailCall');
    assertThrows(() => w.parseWat('t.wat', TAIL, { tail_call: false }), Error, 'tailCall');
    w.parseWat('t.wat', TAIL, { tail_call: true }).destroy();
    w.parseWat('t.wat', TAIL, { enable_all: true }).destroy();
    // A default feature can be turned OFF: SIMD.
    const simd = '(module (func (result v128) (v128.const i32x4 0 0 0 0)))';
    w.parseWat('s.wat', simd).destroy();
    assertThrows(() => w.parseWat('s.wat', simd, { simd: false }), Error, 'simd');
  });

  it('libwabt.js spellings map, sat_float_to_int included; unknown keys are ignored', async () => {
    const w = await wabt();
    const sat = '(module (func (param f32) (result i32) (i32.trunc_sat_f32_s (local.get 0))))';
    assertThrows(() => w.parseWat('s.wat', sat, { sat_float_to_int: false }), Error);
    w.parseWat('s.wat', sat, { sat_float_to_int: true, no_such_feature: true }).destroy();
  });

  it('toBinary returns a log, a string', async () => {
    const w = await wabt();
    const out = w.parseWat('ok.wat', '(module)').toBinary({});
    assert(out.buffer instanceof ArrayBuffer);
    assertEquals(out.log, '');
  });

  it('readWasm is not gated: a binary using any feature reads, and validates with all', async () => {
    const w = await wabt();
    const { buffer } = w.parseWat('t.wat', TAIL, { enable_all: true }).toBinary({});
    w.readWasm(buffer, { readDebugNames: false }).validate();
  });
});
