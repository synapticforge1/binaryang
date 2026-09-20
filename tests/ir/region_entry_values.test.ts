// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The values a region is ENTERED with are in the tree, typed, and at its start
// (One front end, stage 2, rows R13 and R14). A = binaryen-ts's decoder;
// B = the wabt-ts reader + prepareForPasses.
//
// Two places the format pushes values no instruction in the region produced: a
// carrier's parameters, and a `catch` handler's exception payload. A has always
// seeded one typed `pop` each. B made a placeholder only where an instruction
// asked for a value and dropped every unconsumed one at the end of the region,
// so a handler that BINDS NOTHING lost the payload and a parametrised `if`'s
// arms came back empty, typed `none` where A typed them from the parameter —
// the 6 remaining type differences of stage 1.
//
// ⚠️ Each fixture here is one that DISCRIMINATES: the entry values must survive
// unconsumed, or the case passes either way (a consumed placeholder was always
// typed by `deriveTypes` from its own seeded stack). The first attempt at this
// file asserted two arms that consumed their parameters and proved nothing.
//
// A `pop` writes nothing, so none of this moves a byte — asserted here rather
// than assumed, in both directions: the bytes come back identical AND the
// engine still accepts them.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type { DropExpr, Expr, IfExpr, RegionExpr, TryExpr } from '../../src/wabt-ts/ir/ir.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader.ts';
import { writeBinaryIr } from '../../src/wabt-ts/writer/binary-writer.ts';
import { hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { parseWasm } from '../../src/binaryen-ts/binary/index.ts';
import { prepareForPasses } from '../../src/binaryen-ts/ir/prepare.ts';

const asm = (wat: string) => {
  const r = wat2wasm(wat, { textForm: false });
  assert(!hasErrors(r.errors) && r.binary.length > 0, `assembles: ${JSON.stringify(r.errors)}`);
  assert(WebAssembly.validate(r.binary as BufferSource), 'the engine accepts the fixture');
  return r.binary;
};
const routes = (bytes: Uint8Array) => ({
  A: parseWasm(bytes),
  B: prepareForPasses(readBinaryIr(bytes, makeErrorList(), { readDebugNames: true })),
});
/** Every node of a region as `kind(type)` — the shape both routes must share. */
const shape = (r: RegionExpr) =>
  r.children.map((e) => `${e.kind}(${JSON.stringify((e as { type?: unknown }).type)})`);
const body = (m: { functions: readonly { body: RegionExpr }[] }) => m.functions[0]!.body;
const find = (m: { functions: readonly { body: RegionExpr }[] }, kind: string) => {
  const e = body(m).children.find((x) => x.kind === kind);
  assert(e !== undefined, `the body holds a ${kind}`);
  return e;
};
/** The reader's own round trip: a seeded `pop` must write nothing. */
const reread = (bytes: Uint8Array) => writeBinaryIr(readBinaryIr(bytes, makeErrorList(), {}), {});
const bytesUnmoved = (bytes: Uint8Array) => {
  const out = reread(bytes);
  assert(
    out.length === bytes.length && out.every((x, i) => x === bytes[i]),
    `byte-identical round trip (${bytes.length} in, ${out.length} out)`,
  );
  assert(WebAssembly.validate(out as BufferSource), 'and still valid');
};

const I32 = 127, F64 = 124;

describe('a `catch` handler is entered with the tag payload (R13)', () => {
  // The handler binds NOTHING: the caught i32 falls through as the try's result,
  // so the payload is all the region holds. B's handler came back EMPTY.
  const bytes = asm(`(module
    (tag $t (param i32))
    (func (export "f") (result i32)
      (try (result i32)
        (do (i32.const 1))
        (catch $t))))`);
  const handler = (m: { functions: readonly { body: RegionExpr }[] }) =>
    (find(m, 'try') as TryExpr).catches[0]!.body;

  it('both routes hold one typed `pop` for the payload', () => {
    const { A, B } = routes(bytes);
    assertEquals(shape(handler(A)), ['pop(127)'], 'the decoder seeds it');
    assertEquals(shape(handler(B)), ['pop(127)'], 'the reader seeds it too');
    // A region's type is its last child's on both sides, so seeding is what
    // makes this the payload's type rather than `none`.
    assertEquals(handler(B).type, handler(A).type);
    assertEquals(handler(B).type, I32);
  });

  it('a multi-parameter tag seeds parameter order, last on top', () => {
    const bs = asm(`(module
      (tag $t (param i32 f64))
      (func (export "f") (result f64)
        (try (result f64)
          (do (f64.const 1))
          (catch $t (drop) (f64.convert_i32_s)))))`);
    const { A, B } = routes(bs);
    // `drop` takes the TOP value — the LAST parameter, f64 — and the conversion
    // then takes the i32 beneath it. Which value each took is the assertion.
    const took = (r: RegionExpr) => {
      const d = r.children.find((e) => e.kind === 'drop') as DropExpr | undefined;
      const u = r.children.find((e) => e.kind === 'unary') as { value: Expr } | undefined;
      assert(d !== undefined && u !== undefined, 'the handler drops one value and converts one');
      return [(d.value as { type?: unknown }).type, (u.value as { type?: unknown }).type];
    };
    assertEquals(took(handler(B)), took(handler(A)), 'both routes bind the same way');
    assertEquals(took(handler(B)), [F64, I32], 'the top value is the last parameter');
    bytesUnmoved(bs);
  });

  it('seeding writes nothing', () => bytesUnmoved(bytes));
});

describe("a parametrised carrier's regions are entered with its parameters (R14)", () => {
  // Empty arms pass the parameters straight through as the `if`'s results, so
  // nothing consumes them. B's arms came back empty and typed `none`.
  const bytes = asm(`(module
    (type $p (func (param i32 i32) (result i32 i32)))
    (func (export "f") (result i32 i32)
      (i32.const 1) (i32.const 2) (i32.const 0)
      (if (type $p) (then) (else))))`);

  it('the arm holds one typed `pop` per parameter, on both routes', () => {
    const { A, B } = routes(bytes);
    const arm = (m: typeof A) => (find(m, 'if') as IfExpr).ifTrue;
    assertEquals(shape(arm(B)), shape(arm(A)));
    assertEquals(shape(arm(B)), ['pop(127)', 'pop(127)']);
    assertEquals(arm(B).type, arm(A).type);
  });

  it('the entry values come FIRST, before the statements that ran with them', () => {
    // The order is what `[...stmts, ...stack]` gets wrong: a parameter emitted
    // after the `nop` makes the region's type the parameter's instead of the
    // `nop`'s, and the arms stop matching the decoder. Both arms are seeded —
    // the values were evaluated once, before the `if` — so this also pins the
    // re-seeding an `else` needs.
    const bs = asm(`(module
      (type $p (func (param i32 i32) (result i32 i32)))
      (func (export "f") (result i32 i32)
        (i32.const 1) (i32.const 2) (i32.const 0)
        (if (type $p) (then (nop)) (else (nop)))))`);
    const { A, B } = routes(bs);
    const arms = (m: typeof A) => {
      const iff = find(m, 'if') as IfExpr;
      assert(iff.ifFalse !== null, 'the fixture keeps its else arm');
      return [iff.ifTrue, iff.ifFalse];
    };
    for (const i of [0, 1]) {
      const a = arms(A)[i]!, b = arms(B)[i]!;
      assertEquals(shape(b), shape(a), `arm ${i}: the same region on both routes`);
      assertEquals(
        shape(b),
        ['pop(127)', 'pop(127)', 'nop("none")'],
        `arm ${i}: entry values first`,
      );
      assertEquals(b.type, a.type, `arm ${i}: and the same region type`);
    }
    bytesUnmoved(bs);
  });

  it('a `block` whose parameters ARE consumed reads the same on both routes', () => {
    const bs = asm(`(module
      (type $p (func (param i32 i32) (result i32)))
      (func (export "f") (result i32)
        (i32.const 7) (i32.const 8)
        (block (type $p) (i32.add))))`);
    const { A, B } = routes(bs);
    const inner = (m: typeof A) => find(m, 'block') as { children: readonly Expr[] };
    assertEquals(inner(B).children.map((e) => e.kind), inner(A).children.map((e) => e.kind));
    bytesUnmoved(bs);
  });

  it('seeding writes nothing', () => bytesUnmoved(bytes));
});
