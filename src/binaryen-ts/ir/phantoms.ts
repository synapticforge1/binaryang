// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/ir/phantoms
 *
 * What a PHANTOM operand may stand for, and where it must not execute.
 *
 * After a transfer (`br`, `return`, `throw`, …) the wasm stack is polymorphic:
 * an instruction may take values that were never pushed. A tree must still fill
 * those operand slots, and both front ends fill them with a phantom — the
 * decoder with `unreachable`, the reader with a `pop` that has nothing behind it
 * (which the spill turns into `unreachable` when a pass will run).
 *
 * `unreachable` IS the right value for a phantom — of the bottom type, and it
 * never returns — as long as the code holding it is already dead. It is not when
 * the transfer that makes it dead is a LATER operand of the same consumer:
 *
 *     br 0            ⟶  (i32.add (unreachable) (br 0))
 *     i32.add
 *
 * The bytes run `br 0` and never reach `i32.add`; the tree evaluates its left
 * operand first and TRAPS. `spec/br/br.0.wasm`'s `type-i32-i32` did exactly
 * that, on route A with no pass at all and on route B once optimized.
 *
 * So such a consumer is taken apart: it never runs, and what it stood for is its
 * real operands up to the transfer, evaluated in order, then the transfer —
 * several statements where one expression stood, which `mapWithSequences`
 * places. A consumer whose transfer is a bare `unreachable` is left alone: the
 * phantom traps first instead of it, and a trap is a trap (upstream decodes
 * `unreachable; i32.add` as `(i32.add (unreachable) (unreachable))`, and the
 * fixture pinning that stays a fixed point).
 */

import {
  type Expression,
  ExpressionKind,
  makeDrop,
  type RegionExpr,
  typeOf,
} from './expressions.ts';
import { None, Unreachable } from './types.ts';
import { mapWithSequences, visitChildren } from './walk.ts';

/**
 * `e`'s operands in EVALUATION order — its children other than the sequences it
 * owns. ⚠️ Not `visitChildren`'s order for a branch: that visits a `br_if`'s and
 * a `br_table`'s condition before their values, and wasm pushes the values
 * first.
 */
export function operandsInOrder(e: Expression): Expression[] {
  switch (e.kind) {
    case ExpressionKind.Break:
      return e.condition === undefined || e.condition === null
        ? [...e.values]
        : [...e.values, e.condition];
    case ExpressionKind.Switch:
      return [...e.values, e.condition];
    case ExpressionKind.Block:
      return [...(e.params?.values ?? [])]; // its children are a sequence, not operands
    case ExpressionKind.Region:
      // A sequence, never operands. 🔧 Missing at first, so `visitChildren`
      // handed a region's STATEMENTS back as operands, and a loop body
      // `[pop, pop, …, return]` read as a consumer with phantoms before a
      // transfer: it was taken apart (`spec/fac/fac.0.wasm`, route A, -O1).
      return [];
    default: {
      const out: Expression[] = [];
      visitChildren(e, (c) => {
        if (c.kind !== ExpressionKind.Region) out.push(c);
      });
      return out;
    }
  }
}

/** An operand as a statement that still evaluates it: one value is dropped. */
function evaluated(e: Expression): Expression {
  const t = typeOf(e);
  return t === None || t === Unreachable || Array.isArray(t) ? e : makeDrop(e);
}

/**
 * Takes apart every consumer in `body` whose leading operands are phantoms
 * (`isPhantom`) followed by a transfer that is not a bare `unreachable` — see
 * the module doc. Returns the body, rebuilt where anything changed.
 */
export function collapsePhantomConsumers(
  body: RegionExpr,
  isPhantom: (e: Expression) => boolean,
): RegionExpr {
  return mapWithSequences(body, (n) => {
    const ops = operandsInOrder(n);
    const t = ops.findIndex((o) => !isPhantom(o) && typeOf(o) === Unreachable);
    if (t <= 0) return n;
    const transfer = ops[t]!;
    if (transfer.kind === ExpressionKind.Unreachable) return n;
    const before = ops.slice(0, t);
    if (!before.some(isPhantom)) return n; // real values below it: nothing runs early
    return { sequence: [...before.filter((o) => !isPhantom(o)).map(evaluated), transfer] };
  });
}
