// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.21 — two switches in `wat-writer.ts` are coupled, and nothing said so.
//
// `writeFoldedConstExpr` renders the grammar slots that take exactly ONE folded
// constant instruction (a table initializer is the live one — T10.3). It splits
// on operand count:
//
//     if (operands.length === 0) this.writeExprList([e]);   // leaf: whole expr
//     else { this.writeInstrHead(e); ...write each operand... }
//
// So a kind that `constExprOperands` returns a NON-EMPTY list for must have a
// `writeInstrHead` case. If it does not, `writeInstrHead`'s `default` falls
// back to `writeExprList([e])` — the full linear rendering, operands included —
// and the loop then writes those operands a SECOND time.
//
// The failure mode is the bad kind: the output is not rejected, it REPARSES.
// Confirmed by deleting the `ref.i31` case and round-tripping a table
// initializer:
//
//     correct:  (table $T0 2 (ref i31) (ref.i31 (i32.const 7)))
//     drifted:  (table $T0 2 (ref i31) (i32.const 7 ref.i31 (i32.const 7)))
//
// Both parse. The second is a different module. This is the same shape as the
// `writeCatch` duplication (T10.6), where the handler body was written by the
// callback AND walked again by the visitor.
//
// The two switches agreed when this was written; the point of the test is that
// nothing made them, and neither function's signature hints at the other. This
// reads both out of the source, so adding a case to one and not the other is
// red at once rather than a silently different module later.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

const SOURCE = new URL('../../../src/wabt-ts/writer/wat-writer.ts', import.meta.url);

/** Body text of a named function in the writer source, by brace matching. */
function functionBody(src: string, needle: string): string {
  const start = src.indexOf(needle);
  assert(start !== -1, `could not locate ${needle} in wat-writer.ts`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${needle}`);
}

/**
 * Kinds `constExprOperands` returns a NON-EMPTY operand list for — i.e. the
 * ones that take the `writeInstrHead` path. Case labels stack, so a label only
 * counts once the following `return` is seen.
 */
function kindsWithOperands(body: string): Set<string> {
  const out = new Set<string>();
  let pending: string[] = [];
  for (const line of body.split('\n')) {
    const c = /case '([^']+)':/.exec(line);
    if (c) {
      pending.push(c[1]!);
      continue;
    }
    const r = /return\s+([^;]+);/.exec(line);
    if (r && pending.length > 0) {
      // `return [];` is the leaf path and carries no obligation.
      if (r[1]!.trim() !== '[]') { for (const k of pending) out.add(k); }
      pending = [];
    }
  }
  return out;
}

function caseLabels(body: string): Set<string> {
  return new Set([...body.matchAll(/case '([^']+)':/g)].map((m) => m[1]!));
}

describe('T13.21 — constExprOperands and writeInstrHead stay in sync', () => {
  it('gives every operand-bearing constant expression a head-writer case', async () => {
    const src = await Deno.readTextFile(SOURCE);
    const withOperands = kindsWithOperands(
      functionBody(src, 'function constExprOperands(e: Expr): Expr[] | null {'),
    );
    const heads = caseLabels(functionBody(src, 'private writeInstrHead(e: Expr): void {'));

    assert(withOperands.size >= 5, `operand-bearing enumeration looks wrong: ${withOperands.size}`);

    const missing = [...withOperands].filter((k) => !heads.has(k)).sort();
    assert(
      missing.length === 0,
      `${missing.length} constant-expression kind(s) carry operands but have no ` +
        `writeInstrHead case: ${missing.join(', ')}. Their operands will be written ` +
        'TWICE and the result still reparses — add the case.',
    );
  });

  it('round-trips a folded table initializer without duplicating its operand', () => {
    // The behavioural half. `ref.i31` is the shape the drift experiment used;
    // if the coupling breaks, the operand appears twice here.
    const src = '(module (table 2 (ref i31) (ref.i31 (i32.const 7))))';
    const first = wat2wasm(src);
    if (hasErrors(first.errors)) throw new Error(formatErrors(first.errors));
    assert(first.binary);

    const text = wasm2wat(first.binary).text ?? '';
    assertEquals(
      (text.match(/i32\.const 7/g) ?? []).length,
      1,
      `the initializer operand was written more than once:\n${text}`,
    );

    // And the round trip is a fixed point, which duplication would break on
    // the second pass even where the first still reparsed.
    const again = wat2wasm(text);
    if (hasErrors(again.errors)) throw new Error(formatErrors(again.errors));
    assert(again.binary);
    assertEquals([...again.binary], [...first.binary], 'round trip is not a fixed point');
  });
});
