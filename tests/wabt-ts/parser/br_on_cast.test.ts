// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T5.3 — `br_on_cast` / `br_on_cast_fail` were never implemented. The two
// `GcOpcode` entries (0xfb 0x18 / 0x19) and their name-table rows existed, so
// the gap looked smaller than it was: there was no token, no IR node, no
// parser case, no name resolution, no encoder, no decoder, no printer and no
// validator rule. Every use failed at parse with "expected ), got (" on the
// first reference-type immediate.
//
// Two details of the encoding are easy to get wrong, and both are asserted
// below against V8:
//
//   * Nullability of BOTH reference types travels in ONE flags byte that
//     precedes the label — bit 0 for rt1, bit 1 for rt2 — not in the heap
//     types themselves. Immediate order is `flags, label, rt1, rt2`.
//   * The instruction FALLS THROUGH with the ref still on the stack. The
//     binary reader must commit it as a statement rather than leave it on its
//     operand stack: `endFrame` splices leftover stack values in AFTER every
//     statement, so a stack push sank the br_on_cast past the rest of the
//     block body and `wasm2wat` printed the block in the wrong order (the
//     same hazard the parser's `pushStmt` exists to avoid, v1.3.0). The
//     round-trip cases below are what caught it.
//
// Spec testsuite: parse-clean 255 -> 257 (every file), V8-valid 243 -> 245.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

function v8Accepts(wat: string): boolean {
  return WebAssembly.validate(toBuf(compile(wat)));
}

async function run(wat: string, arg: unknown): Promise<unknown> {
  const { instance } = await WebAssembly.instantiate(toBuf(compile(wat)));
  return (instance.exports.f as (a: unknown) => unknown)(arg);
}

/** The `n` bytes following the first `0xfb <sub>` pair, or null if absent. */
function afterOpcode(b: Uint8Array, sub: number, n: number): number[] | null {
  for (let i = 0; i + 2 + n <= b.length; i++) {
    if (b[i] === 0xfb && b[i + 1] === sub) return [...b.slice(i + 2, i + 2 + n)];
  }
  return null;
}

// `(block $l (result (ref i31)) (br_on_cast …) (return -1))` then `i31.get_u`:
// returns the i31's value when the cast succeeds, -1 when it does not.
const CAST = `(module (func (export "f") (param $x anyref) (result i32)
  (block $l (result (ref i31))
    (br_on_cast $l anyref (ref i31) (local.get $x))
    (return (i32.const -1)))
  (i31.get_u)))`;

describe('br_on_cast — end to end', () => {
  it('branches on a successful cast and falls through on a failed one', async () => {
    assertEquals(await run(CAST, 7), 7);
    assertEquals(await run(CAST, null), -1);
    assertEquals(await run(CAST, {}), -1);
  });

  it('br_on_cast_fail inverts which path is taken', async () => {
    const wat = `(module (func (export "f") (param $x anyref) (result i32)
      (block $l (result anyref)
        (br_on_cast_fail $l anyref (ref i31) (local.get $x))
        (return (i31.get_u)))
      (drop)
      (i32.const -1)))`;
    assertEquals(await run(wat, 7), 7);
    assertEquals(await run(wat, null), -1);
  });

  it('casts to a user-defined heap type', () => {
    assert(v8Accepts(`(module
      (type $st (struct (field i32)))
      (func (export "f") (param $x anyref) (result i32)
        (block $l (result (ref $st))
          (br_on_cast $l anyref (ref $st) (local.get $x))
          (return (i32.const -1)))
        (struct.get $st 0)))`));
  });

  it('takes its operand from the surrounding stack when written with no child', () => {
    // `(br_on_cast $l rt1 rt2)` with no inline sub-expression — the testsuite
    // writes it this way inside a block that declares a param.
    assert(v8Accepts(`(module (func (export "f") (param $x anyref) (result i32)
      (local.get $x)
      (block $l (param anyref) (result (ref i31))
        (br_on_cast $l anyref (ref i31))
        (return (i32.const -1)))
      (i31.get_u)))`));
  });
});

describe('br_on_cast — immediate encoding', () => {
  // flags, label, rt1 heap byte, rt2 heap byte.
  // 0x6e = any, 0x6c = i31, 0x6b = struct.
  const cases: ReadonlyArray<readonly [string, string, string, number[]]> = [
    ['rt1 nullable, rt2 not', '(ref null any) (ref i31)', '(ref i31)', [0b01, 0, 0x6e, 0x6c]],
    ['both nullable', '(ref null any) (ref null i31)', '(ref null i31)', [0b11, 0, 0x6e, 0x6c]],
    ['neither nullable', '(ref any) (ref i31)', '(ref i31)', [0b00, 0, 0x6e, 0x6c]],
    [
      'rt2 nullable only',
      '(ref any) (ref null struct)',
      '(ref null struct)',
      [0b10, 0, 0x6e, 0x6b],
    ],
  ];
  for (const [name, imm, blockResult, expected] of cases) {
    it(name, () => {
      const bin = compile(`(module (func (export "f") (param $x anyref)
        (block $l (result ${blockResult})
          (br_on_cast $l ${imm} (local.get $x))
          (unreachable))
        (drop)))`);
      assertEquals(afterOpcode(bin, 0x18, 4), expected);
    });
  }

  it('the abbreviated `anyref` spelling means `(ref null any)`', () => {
    const bare = compile(CAST);
    const spelled = compile(CAST.replace('$l anyref', '$l (ref null any)'));
    assertEquals([...bare], [...spelled]);
  });

  it('a user-defined heap type encodes as its type index', () => {
    const bin = compile(`(module
      (type $a (struct)) (type $b (struct)) (type $st (struct (field i32)))
      (func (export "f") (param $x anyref)
        (block $l (result (ref $st))
          (br_on_cast $l anyref (ref $st) (local.get $x))
          (unreachable))
        (drop)))`);
    // rt1 = any (0x6e), rt2 = type index 2 — NOT 0, which is what an
    // unresolved name-var would have produced.
    assertEquals(afterOpcode(bin, 0x18, 4), [0b01, 0, 0x6e, 2]);
  });

  it('br_on_cast_fail uses sub-opcode 0x19, not 0x18', () => {
    const bin = compile(`(module (func (export "f") (param $x anyref)
      (block $l (result anyref)
        (br_on_cast_fail $l anyref (ref i31) (local.get $x))
        (unreachable))
      (drop)))`);
    assertEquals(afterOpcode(bin, 0x18, 1), null, 'must not emit the br_on_cast opcode');
    assertEquals(afterOpcode(bin, 0x19, 4), [0b01, 0, 0x6e, 0x6c]);
  });
});

describe('br_on_cast — round-trip', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['br_on_cast', CAST],
    [
      'br_on_cast_fail',
      `(module (func (export "f") (param $x anyref) (result i32)
        (block $l (result anyref)
          (br_on_cast_fail $l anyref (ref i31) (local.get $x))
          (return (i32.const 1)))
        (drop) (i32.const -1)))`,
    ],
    [
      'nullable rt2',
      `(module (func (export "f") (param $x anyref) (result i32)
        (block $l (result (ref null i31))
          (br_on_cast $l anyref (ref null i31) (local.get $x))
          (return (i32.const -1)))
        (drop) (i32.const 1)))`,
    ],
  ];
  for (const [name, wat] of cases) {
    it(`${name} survives wasm2wat -> wat2wasm byte-identically`, () => {
      const first = compile(wat);
      const { text, errors } = wasm2wat(first);
      assert(!hasErrors(errors) && text, formatErrors(errors));
      const second = compile(text);
      assertEquals([...second], [...first]);
    });
  }

  it('the printed block keeps source order', () => {
    // The reader used to leave br_on_cast on its operand stack, and leftover
    // stack values are spliced in AFTER every statement — so the branch was
    // printed below the `return` that follows it, i.e. in dead code.
    const { text } = wasm2wat(compile(CAST));
    assert(text);
    const body = text.slice(text.indexOf('block'), text.indexOf('end'));
    assert(
      body.indexOf('br_on_cast') < body.indexOf('i32.const -1'),
      `branch sank past the code after it:\n${body}`,
    );
  });
});
