// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Robustness: the parser must always REPORT malformed input, never crash on
// it. Four defects broke that guarantee, all found while surveying the
// WebAssembly spec testsuite:
//
//   1. `nan:0x7f_ffff` escaped as a raw `SyntaxError` from `BigInt()`. The
//      NaN-payload branch neither stripped the `_` digit separators the
//      neighbouring hexfloat/float branches already strip, nor guarded the
//      call. A caller feeding the parser untrusted text should never need a
//      try/catch.
//   2. `(module (type $s (struct (field i1` HUNG and then exhausted memory.
//      `parseValueType` reports an error and returns null WITHOUT consuming
//      the offending token, and the struct-field shorthand loop had no
//      progress check — so it appended a field plus an error forever. Found
//      by mutation-fuzzing the testsuite; the process died with
//      "Fatal JavaScript out of memory".
//   3. The `select (result …)` loop had the same shape with no break at all.
//   4. The f32 NaN payload mask was 0x3fffff (22 bits) instead of 0x7fffff
//      (23). `f32.const nan:0x400000` — payload = exactly the quiet bit —
//      masked to zero and emitted 0x7f800000, which is INFINITY, not a NaN.
//      Silent corruption; `literal.ts`'s F32_MANTISSA_MASK already had it
//      right.
//
// Separately, diagnostics rendered unnamed tokens as `<token:163>`; every
// error in the survey had to be post-processed through the TokenType enum by
// hand before it was actionable.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript, parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

/** Parse, asserting only that nothing escapes as an exception. */
function parseNoThrow(src: string): { errored: boolean } {
  try {
    return { errored: hasErrors(parseWastScript(src).errors) };
  } catch (e) {
    throw new Error(`parser threw instead of reporting: ${(e as Error).message}`);
  }
}

describe('robustness — NaN payloads', () => {
  it('accepts digit separators in a NaN payload', () => {
    const { errors } = parseWastScript('(module (func (f32.const nan:0x7f_ffff) drop))');
    assert(!hasErrors(errors), formatErrors(errors));
  });

  it('accepts digit separators in an f64 NaN payload', () => {
    const { errors } = parseWastScript('(module (func (f64.const nan:0xf_ffff_ffff_ffff) drop))');
    assert(!hasErrors(errors), formatErrors(errors));
  });

  it('reports a malformed NaN payload instead of throwing', () => {
    for (const bad of ['nan:0xzz', 'nan:', 'nan:99', 'nan:0b11']) {
      const r = parseNoThrow(`(module (func (f32.const ${bad}) drop))`);
      assert(r.errored, `expected \`${bad}\` to be reported as an error`);
    }
  });

  it('uses the full 23-bit f32 payload field', () => {
    // nan:0x400000 is exactly the quiet bit. With the old 22-bit mask it
    // became 0x7f800000 — infinity.
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['nan:0x400000', 0x7fc00000],
      ['nan:0x7fffff', 0x7fffffff],
      ['nan:0x1', 0x7f800001],
    ];
    for (const [lit, want] of cases) {
      const { binary, errors } = wat2wasm(`(module (func (result f32) (f32.const ${lit})))`);
      assert(binary, formatErrors(errors));
      const i = binary.lastIndexOf(0x43); // f32.const
      const got = new DataView(binary.buffer, binary.byteOffset + i + 1, 4).getUint32(0, true);
      assertEquals(got, want, `${lit}: got 0x${got.toString(16)}`);
    }
  });

  it('emits a real NaN, not infinity, for nan:0x400000', async () => {
    const { binary } = wat2wasm(
      '(module (func (export "f") (result f32) (f32.const nan:0x400000)))',
    );
    assert(binary);
    const buf = new ArrayBuffer(binary.byteLength);
    new Uint8Array(buf).set(binary);
    const { instance } = await WebAssembly.instantiate(buf);
    const v = (instance.exports.f as () => number)();
    assert(Number.isNaN(v), `expected NaN, got ${v}`);
  });
});

describe('robustness — parse loops always make progress', () => {
  // Each of these used to spin forever and exhaust memory.
  const hangs: ReadonlyArray<readonly [string, string]> = [
    ['struct field, bad type token', '(module (type $s (struct (field i1'],
    ['struct field, stray lparen', '(module (type $s (struct (field i16 ('],
    ['select result, stray lparen', '(module (func (select (result ('],
  ];
  for (const [name, src] of hangs) {
    it(`terminates: ${name}`, () => {
      const started = performance.now();
      const r = parseNoThrow(src);
      assert(r.errored, 'expected errors for malformed input');
      // Generous, but a spinning loop never returns at all.
      assert(performance.now() - started < 5000, 'parse took suspiciously long');
    });
  }

  it('terminates on deeply unbalanced input', () => {
    parseNoThrow('('.repeat(5000));
    parseNoThrow('(module (func '.repeat(500));
  });
});

describe('robustness — diagnostics name their tokens', () => {
  it('names the offending token instead of printing an ordinal', () => {
    // A token whose name lives only in TOKEN_NAMES, not in the parser's local
    // switch — the case that used to render as `<token:N>`.
    // NOTE: this input has been re-picked once already. `(type $t (sub …))`
    // was used here until T5 made it parse cleanly, leaving no diagnostic to
    // inspect. A test that asserts on an error message is coupled to that
    // construct staying unsupported.
    const { errors } = parseWatModule('(module (rec (type $a (struct)) (nonsense)))');
    const msg = errors[0]?.message ?? '';
    assert(!/<token:\d+>/.test(msg), `unreadable diagnostic: ${msg}`);
    assert(msg.length > 0, 'expected a diagnostic');
  });

  it('never renders an ordinal across a spread of malformed inputs', () => {
    const bad = [
      '(module (type (struct (field (mut)))))',
      '(module (rec (type $a (struct)) (nonsense)))',
      '(module (func (block (param i32))))',
      '(module (elem (i32.const 0) funcref (nonsense)))',
      '(module (func (drop (ref.null i32))))',
      '(module (module))',
      '(module (func (local)))',
    ];
    for (const src of bad) {
      for (const e of parseWatModule(src).errors) {
        assert(!/<token:\d+>/.test(e.message), `${src}: ${e.message}`);
      }
    }
  });

  it('no spec-testsuite diagnostic renders a raw token ordinal', () => {
    // The survey's whole error corpus, checked in one pass. `wasmtk/` is a
    // gitignored sibling checkout, so skip when it isn't present.
    //
    // The corpus is now MUTATED rather than taken as-is. This test used to
    // parse the testsuite verbatim and inspect whatever diagnostics fell
    // out — but the repair campaign took the testsuite to 257/257 parsing
    // clean, so there were no diagnostics left and the `checked > 0` guard
    // fired. Truncating each file at several offsets guarantees material
    // regardless of how much of the grammar we support, and it still draws
    // on real-world token variety rather than a handful of hand-written
    // strings (the previous test above covers those).
    const dir = 'wasmtk/tests/module/wasm_wast/testsuite-main';
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch {
      return; // spec testsuite not checked out
    }
    let checked = 0;
    for (const e of entries) {
      if (!e.name.endsWith('.wast')) continue;
      const src = Deno.readTextFileSync(`${dir}/${e.name}`);
      for (const frac of [0.17, 0.41, 0.73, 0.95]) {
        const cut = src.slice(0, Math.floor(src.length * frac));
        for (const err of parseWastScript(cut).errors) {
          assert(!/<token:\d+>/.test(err.message), `${e.name}@${frac}: ${err.message}`);
          checked++;
        }
      }
    }
    assert(checked > 0, 'expected to have checked some diagnostics');
  });
});
