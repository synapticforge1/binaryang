// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A control construct TYPED unreachable is not stack-polymorphic after its `end`.
//
// wasm validates a `block` / `if` / `loop` / `try` / `try_table` against its
// DECLARED type: after `end` the stack holds exactly its results, even when every
// path inside throws or traps. The IR may still type such a construct
// `unreachable` (an `if` inferred from two unreachable arms, a block ending in
// `unreachable`), and a pass reading that type is entitled to treat what follows
// as dead. Two holes let the two views disagree (found 2026-09-14, when -Oz on
// the legacy EH spec files failed 30 of 70 assertions — all of one module):
//
//   1. the DECODER typed a void `if` whose arms both end unreachable as
//      `unreachable` rather than as written. DCE then deleted the `i32.const 2`
//      after it, and the enclosing `try (result i32)` was left short a value:
//      "expected 1 elements on the stack for fallthru, found 0";
//   2. the ENCODER wrote a construct typed unreachable as a plain `end`, so a tree
//      a PASS built that way was invalid wherever a value had to follow — StripEH
//      on `(block (result i32) (throw $e (local.get 0)))` wrote the inner
//      `block drop unreachable end` and nothing after it.
//
// Upstream binaryen's writer emits an extra `unreachable` after every construct
// typed unreachable (`wasm-stack.h`, `visitBlock` / `visitIf` / `visitLoop` /
// `visitTry` / `visitTryTable`); ours now does too. A DECODED construct carries
// its declared type, so a plain decode → encode still writes no extra byte.

import { assert, assertEquals } from '@std/assert';

import { parseWasm } from '../../../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';
import type { Expression } from '../../../src/binaryen-ts/ir/expressions.ts';
import type { WasmModule } from '../../../src/binaryen-ts/ir/module.ts';
import { parseWat } from '../../../src/binaryen-ts/parser/wat-parser.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  return r.binary;
}

function runPass(bytes: Uint8Array, pass: string): Uint8Array {
  const mod = parseWasm(bytes);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add(pass).run();
  return encodeWasm(mod);
}

function call(bytes: Uint8Array, x: number): number | string {
  const f = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource)).exports.f as (
    x: number,
  ) => number;
  try {
    return f(x);
  } catch (e) {
    return e instanceof WebAssembly.RuntimeError ? 'trap' : 'exception';
  }
}

// The spec's `try_catch.wast` shape, reduced: both arms throw, and the value the
// try's type needs is written after the `if`.
const LEGACY_TRY = `(module (tag $a) (tag $b)
  (func (export "f") (param i32) (result i32)
    (try (result i32)
      (do (if (local.get 0) (then (throw $a)) (else (throw $b))) (i32.const 2))
      (catch $a (i32.const 3))
      (catch $b (i32.const 4)))))`;

// The same hole with no exception handling at all.
const PLAIN_BLOCK = `(module
  (func (export "f") (param i32) (result i32)
    (block (result i32)
      (if (local.get 0) (then (unreachable)) (else (unreachable)))
      (i32.const 2))))`;

Deno.test('DCE: a void if whose arms both throw keeps what its try needs after it', () => {
  const out = runPass(assemble(LEGACY_TRY), 'DCE');
  assertEquals([call(out, 1), call(out, 0)], [3, 4]);
});

Deno.test('DCE: the same, with no EH — a void if whose arms both trap', () => {
  const out = runPass(assemble(PLAIN_BLOCK), 'DCE');
  assertEquals([call(out, 1), call(out, 0)], ['trap', 'trap']);
});

Deno.test('decode → encode: a void if with unreachable arms writes no extra byte', () => {
  for (const wat of [LEGACY_TRY, PLAIN_BLOCK]) {
    const bytes = assemble(wat);
    assertEquals(encodeWasm(parseWasm(bytes)), bytes);
  }
});

Deno.test('encoder: a construct a pass typed unreachable is followed by unreachable', () => {
  // StripEH turns the throw into `block (drop …) (unreachable)` — typed
  // unreachable, and the last instruction of a `block (result i32)`. (At a
  // function's top level the region flattens it, so it must be nested.)
  const out = runPass(
    assemble(`(module (tag $e (param i32))
      (func (export "f") (param i32) (result i32)
        (block (result i32) (throw $e (local.get 0)))))`),
    'StripEH',
  );
  assertEquals(call(out, 5), 'trap');
});

// ---------------------------------------------------------------------------
// The TEXT path had the decoder's hole, for every carrier (2026-09-16).
//
// binaryen-ts's WAT parser typed an unannotated construct by INFERENCE — its last
// child (block, try, try_table) or its arms (if) — so each fixture below came
// out typed `unreachable`, and the encoder's extra `unreachable` (right for a
// construct a pass built that way) was written after an `end` the source never
// followed with one. Valid, and not the module that was written. A construct's
// type is what it declares (owner, 2026-09-16); the text path now says so, and
// agrees with the decoder node for node and byte for byte.
// ---------------------------------------------------------------------------

const TEXT_CARRIERS: Record<string, string> = {
  'void block': `(module (func (export "f") (param i32) (result i32)
    (block (result i32) (block (unreachable)) (i32.const 2))))`,
  'void if, both arms trap': PLAIN_BLOCK,
  'typed if, both arms trap': `(module (func (export "f") (param i32) (result i32)
    (if (result i32) (local.get 0) (then (unreachable)) (else (unreachable)))))`,
  'void loop': `(module (func (export "f") (param i32) (result i32)
    (block (result i32) (loop (unreachable)) (i32.const 2))))`,
  'void try_table': `(module (tag $e) (func (export "f") (param i32) (result i32)
    (block (result i32) (try_table (throw $e)) (i32.const 2))))`,
  'void try': LEGACY_TRY,
};

const CARRIERS = new Set(['block', 'loop', 'if', 'try', 'try_table']);

/** Every carrier's `type`, in tree order. */
function carrierTypes(root: Expression): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string' && CARRIERS.has(o.kind)) out.push(o.type);
    for (const [k, c] of Object.entries(o)) if (k !== 'type') walk(c);
  };
  walk(root);
  return out;
}

/** The code section's bytes (id 10). */
function codeSection(bytes: Uint8Array): Uint8Array {
  let i = 8;
  while (i < bytes.length) {
    const id = bytes[i++]!;
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++]!;
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (id === 10) return bytes.subarray(i, i + size);
    i += size;
  }
  throw new Error('no code section');
}

for (const [name, wat] of Object.entries(TEXT_CARRIERS)) {
  Deno.test(`text path: a ${name} carries its declared type, as the decoder's does`, () => {
    const bytes = assemble(wat);
    const fromText = parseWat(wat);
    const fromBinary = parseWasm(bytes);
    const types = carrierTypes(fromText.functions[0]!.body);
    assert(types.length > 0, 'the fixture has carriers');
    assert(!types.includes('unreachable'), `a carrier typed unreachable: ${JSON.stringify(types)}`);
    assertEquals(types, carrierTypes(fromBinary.functions[0]!.body));
    assertEquals(codeSection(encodeWasm(fromText)), codeSection(bytes));
  });
}

// ---------------------------------------------------------------------------
// Passes build no construct typed `unreachable` (2026-09-16, item 5 (3b)).
//
// StripEH and Inlining put blocks where a stack-polymorphic instruction stood
// (a `throw`; a call whose operand never returns; a void `return_call`), typed
// them `unreachable`, and relied on the encoder's extra `unreachable` byte for
// validity. Now the throw's statements, and the call's, are a `Sequence` the
// walk splices or hoists (`mapWithSequences`), and a try's body block — and an
// inlined body's — DECLARES the construct's type. Checked on the TREE, so the
// encoder's byte cannot be what makes these pass.
// ---------------------------------------------------------------------------

/** Each function whose carriers include one typed `unreachable`, with their types. */
function unreachableCarriers(mod: WasmModule): string[] {
  return mod.functions
    .map((fn) => ({ name: fn.name, types: carrierTypes(fn.body) }))
    .filter(({ types }) => types.includes('unreachable'))
    .map(({ name, types }) => `${name}: ${JSON.stringify(types)}`);
}

const PASS_BUILT: [string, string, string, (bytes: Uint8Array) => unknown][] = [
  [
    'StripEH',
    'a throw that is an OPERAND',
    `(module (tag $e (param i32)) (func (export "f") (param i32) (result i32)
      (i32.add (throw $e (local.get 0)) (i32.const 2))))`,
    (out) => call(out, 1),
  ],
  [
    'StripEH',
    'a throw that is an if CONDITION',
    `(module (tag $e (param i32)) (func (export "f") (param i32) (result i32)
      (if (result i32) (throw $e (local.get 0)) (then (i32.const 1)) (else (i32.const 2)))))`,
    (out) => call(out, 1),
  ],
  [
    'Inlining',
    'a void return_call where a value is due',
    // The block's `i32` is supplied only by `return_call`'s polymorphic stack.
    `(module (func $v) (func (export "f") (param i32)
      (drop (block (result i32) (return_call $v)))))`,
    (out) => WebAssembly.validate(out as BufferSource),
  ],
];

for (const [pass, name, wat, observe] of PASS_BUILT) {
  Deno.test(`${pass}: ${name} — no construct typed unreachable, and it validates`, () => {
    const mod = parseWasm(assemble(wat));
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add(pass).run();
    assertEquals(unreachableCarriers(mod), []);
    const out = encodeWasm(mod);
    assert(WebAssembly.validate(out as BufferSource), `${pass} output validates`);
    if (pass === 'StripEH') assertEquals(observe(out), 'trap');
    else assertEquals(observe(out), true);
  });
}

Deno.test("StripEH: a try's body block declares the TRY's type, not its body's last instruction's", () => {
  // Through the TEXT parser, whose region takes its last instruction's type
  // (`unreachable` here); the decoder's region already carries the declared one,
  // so a binary fixture cannot tell the two apart. An operand, so the block is
  // not the function's only statement (a sole unnamed block dissolves).
  const mod = parseWat(`(module (tag $e) (func (export "f") (param i32) (result i32)
    (i32.add
      (try (result i32) (do (drop (local.get 0)) (throw $e)) (catch $e (i32.const 3)))
      (i32.const 1))))`);
  new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).add('StripEH').run();
  assertEquals(unreachableCarriers(mod), []);
  assertEquals(call(encodeWasm(mod), 1), 'trap');
});
