/**
 * @module binaryen-ts/ir/walk
 *
 * Tree walking utilities for the binaryen-ts IR.
 *
 * The operations:
 *
 * - {@link mapExpression} — transform a tree bottom-up (children first, then
 *   the parent). Used by optimisation passes that rewrite nodes.
 * - {@link mapWithSequences} — the same, where a rewrite may be several
 *   statements standing where one expression stood (a trap replacing a throw).
 * - {@link walkExpression} — visit every node pre-order (parent before
 *   children). Used by analysis passes that only read the tree.
 *
 * @license MIT
 */

import {
  asRegion,
  type BlockParams,
  type Expression,
  ExpressionKind,
  makeDrop,
  makeRegion,
  type QuaternaryExpr,
  type RegionExpr,
  type SIMDExtractExpr,
  type SIMDLoadExpr,
  type SIMDLoadStoreLaneExpr,
  type SIMDReplaceExpr,
  type SIMDShuffleExpr,
  type SIMDTernaryExpr,
} from './expressions.ts';
import { None, Unreachable } from './types.ts';

// ---------------------------------------------------------------------------
// mapExpression — bottom-up tree transform
// ---------------------------------------------------------------------------

/**
 * Maps an expression tree bottom-up.
 *
 * Children are transformed recursively first, then `fn` is called on the
 * resulting node and may return a replacement. Passes that return the same
 * object from `fn` share unchanged subtrees with the original tree.
 *
 * @param expr - Root of the subtree to transform.
 * @param fn   - Called on each node after its children have been transformed.
 * @returns The transformed tree (may share structure with the original).
 */
export function mapExpression(expr: RegionExpr, fn: (e: Expression) => Expression): RegionExpr;
export function mapExpression(expr: Expression, fn: (e: Expression) => Expression): Expression;
export function mapExpression(
  expr: Expression,
  fn: (e: Expression) => Expression,
): Expression {
  const mapped = fn(_mapChildren(expr, (c) => mapExpression(c, fn)));
  // A region in gives a region out — `fn.body = mapExpression(fn.body, …)` is
  // the commonest line in the passes, and `fn` may legitimately replace the
  // region itself (DCE turns an unreachable one into `unreachable`).
  return expr.kind === ExpressionKind.Region ? asRegion(mapped) : mapped;
}

// ---------------------------------------------------------------------------
// mapWithSequences — a bottom-up transform whose rewrite may be several statements
// ---------------------------------------------------------------------------

/**
 * Statements that stand where ONE expression stood, the last of which never
 * falls through (`unreachable`, `br`, `return`, a `throw`, …) — what a pass
 * builds to replace a stack-polymorphic instruction with something that keeps
 * its side effects, e.g. StripEH's `throw $e (x)` → `drop (x)`, `unreachable`.
 */
export interface Sequence {
  readonly sequence: Expression[];
}

/**
 * {@link mapExpression}, where `fn` may return a {@link Sequence}.
 *
 * 🔑 **Why not a block.** A block is a construct: wasm types it by what it
 * DECLARES, and after its `end` the stack holds exactly that — never the
 * polymorphic stack the replaced instruction left. A void block ending in
 * `unreachable`, put where `throw` stood before a value its enclosing block
 * returns, is invalid. That used to be patched by typing such a block
 * `unreachable` and having the encoder write an `unreachable` after its `end`.
 * A construct's type is what it declares (owner, 2026-09-16), so the tree says
 * it instead:
 *
 * - in a LIST (a block's or a region's children) the statements are spliced
 *   in place — no construct, no extra byte;
 * - in an OPERAND slot the consumer never runs, so it is replaced in turn: by
 *   its operands evaluated before (a single value dropped) and then the
 *   sequence. Operands after it are dead and go. This climbs to the nearest
 *   list, so a sequence never reaches the result as a node.
 */
export function mapWithSequences(
  expr: RegionExpr,
  fn: (e: Expression) => Expression | Sequence,
): RegionExpr {
  const r = _mapSeq(expr, fn);
  return isSequence(r) ? makeRegion(r.sequence) : asRegion(r);
}

function isSequence(r: Expression | Sequence): r is Sequence {
  return 'sequence' in r;
}

function _mapSeq(
  expr: Expression,
  fn: (e: Expression) => Expression | Sequence,
): Expression | Sequence {
  if (expr.kind === ExpressionKind.Block || expr.kind === ExpressionKind.Region) {
    // A block's entry values are OPERANDS, evaluated before its list — and, like
    // any operand, a sequence among them means the block never runs.
    let params = expr.kind === ExpressionKind.Block ? expr.params : undefined;
    if (params !== undefined) {
      const values: Expression[] = [];
      for (const v of params.values) {
        const r = _mapSeq(v, fn);
        if (isSequence(r)) return { sequence: [...values.map(asEvaluated), ...r.sequence] };
        values.push(r);
      }
      params = { types: params.types, values };
    }
    const children: Expression[] = [];
    for (const c of expr.children) {
      const r = _mapSeq(c, fn);
      if (isSequence(r)) children.push(...r.sequence);
      else children.push(r);
    }
    return fn({ ...expr, children, ...(params === undefined ? {} : { params }) });
  }
  // Direct children in evaluation order: a carrier's entry values, then its
  // operands, then its regions (which are lists, and absorb any sequence).
  let before: Expression[] = [];
  let hoisted: Expression[] | null = null;
  const rebuilt = _mapChildren(expr, (c) => {
    if (hoisted !== null) return c; // dead: the consumer never runs
    const r = _mapSeq(c, fn);
    if (isSequence(r)) {
      if (c.kind === ExpressionKind.Region) return makeRegion(r.sequence);
      hoisted = [...before, ...r.sequence];
      return c;
    }
    if (c.kind !== ExpressionKind.Region) before = [...before, asEvaluated(r)];
    return r;
  });
  if (hoisted !== null) return { sequence: hoisted };
  return fn(rebuilt);
}

/**
 * An operand as a statement that still evaluates it: one value is dropped, a
 * valueless one stands as it is. A MULTI-value operand stands as it is too — the
 * sequence it precedes ends by never falling through, which discards whatever
 * the stack holds, and `drop` takes exactly one value.
 */
function asEvaluated(e: Expression): Expression {
  const t = e.type;
  return t === undefined || t === None || t === Unreachable || Array.isArray(t) ? e : makeDrop(e);
}

// ---------------------------------------------------------------------------
// walkExpression — pre-order visitor
// ---------------------------------------------------------------------------

/**
 * Visits every node in an expression tree in pre-order (parent before children).
 * Used by analysis passes that collect information without rewriting the tree.
 *
 * @param expr    - Root of the subtree to visit.
 * @param visitor - Called on each node. Return value is ignored.
 */
export function walkExpression(
  expr: Expression,
  visitor: (e: Expression) => void,
): void {
  visitor(expr);
  _visitChildren(expr, (child) => walkExpression(child, visitor));
}

/**
 * Visits the immediate children of an expression in their evaluation order
 * (matching the order the binary encoder emits them in). Unlike
 * {@link walkExpression}, the parent itself is not visited and the recursion
 * does not continue past the direct children — callers control whether to
 * recurse. CFG construction uses this to walk non-control nodes generically.
 *
 * @param expr  - The parent expression whose children to visit.
 * @param visit - Called on each direct child. Return value is ignored.
 */
export function visitChildren(
  expr: Expression,
  visit: (child: Expression) => void,
): void {
  _visitChildren(expr, visit);
}

/**
 * Rebuilds `expr` with each of its **direct** children replaced by `fn(child)`,
 * visiting children in evaluation order. Unlike {@link mapExpression}, `fn` is
 * NOT applied to `expr` itself and the recursion does NOT descend past the
 * direct children — the caller controls whether to recurse. This is the
 * one-level structural rebuild primitive used by passes (e.g. Flatten) that
 * need per-child control while collecting side information in `fn`.
 *
 * @param expr - The parent whose children to rebuild.
 * @param fn   - Maps each direct child to its replacement (called in eval order).
 * @returns A new parent node of the same kind with replaced children.
 */
export function mapChildrenShallow(
  expr: Expression,
  fn: (e: Expression) => Expression,
): Expression {
  return _mapChildren(expr, fn);
}

// ---------------------------------------------------------------------------
// Internal: map children. `fn` is applied to each DIRECT child (shallow);
// `mapExpression` passes a callback that recurses, so it maps the whole tree.
// ---------------------------------------------------------------------------

/**
 * A block-type carrier's {@link BlockParams} with its values mapped, as a
 * fragment to spread into the rebuilt node — or nothing, when it has none.
 * Spread BEFORE the other children: the values are evaluated first.
 */
function mappedParams(
  params: BlockParams | undefined,
  fn: (e: Expression) => Expression,
): { params?: BlockParams } {
  return params ? { params: { types: params.types, values: params.values.map(fn) } } : {};
}

function _mapChildren(
  expr: Expression,
  fn: (e: Expression) => Expression,
): Expression {
  // Every REGION SLOT goes through `asRegion`: `fn` returns an `Expression`,
  // and a pass may replace a region with something else (see mapExpression).
  const slot = (r: Expression) => asRegion(fn(r));
  switch (expr.kind) {
    case ExpressionKind.Block:
      return {
        ...expr,
        ...mappedParams(expr.params, fn),
        children: expr.children.map((c) => fn(c)),
      };

    case ExpressionKind.Region:
      return { ...expr, children: expr.children.map((c) => fn(c)) };

    case ExpressionKind.If:
      return {
        ...expr,
        ...mappedParams(expr.params, fn),
        condition: fn(expr.condition),
        ifTrue: slot(expr.ifTrue),
        ifFalse: expr.ifFalse ? slot(expr.ifFalse) : null,
      };

    case ExpressionKind.Loop:
      return { ...expr, ...mappedParams(expr.params, fn), body: slot(expr.body) };

    // ⚠️ Condition is mapped BEFORE the values, the reverse of wasm's evaluation
    // order (values are pushed first). Kept as it was when `value` became
    // `values` (S6 decision 6A) so that change moved no bytes; see open-work.
    case ExpressionKind.Break:
      return {
        ...expr,
        ...(expr.condition === undefined ? {} : { condition: fn(expr.condition) }),
        values: expr.values.map(fn),
      };

    case ExpressionKind.Switch:
      return {
        ...expr,
        condition: fn(expr.condition),
        values: expr.values.map(fn),
      };

    case ExpressionKind.Return:
      return { ...expr, values: expr.values.map(fn) };

    case ExpressionKind.LocalSet:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.LocalTee:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.TableGet:
      return { ...expr, index: fn(expr.index) };

    case ExpressionKind.TableSet:
      return {
        ...expr,
        index: fn(expr.index),
        value: fn(expr.value),
      };

    case ExpressionKind.GlobalSet:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.Unary:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.Binary:
      return {
        ...expr,
        left: fn(expr.left),
        right: fn(expr.right),
      };

    case ExpressionKind.Select:
      return {
        ...expr,
        val1: fn(expr.val1),
        val2: fn(expr.val2),
        condition: fn(expr.condition),
      };

    case ExpressionKind.Drop:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.Load:
      return { ...expr, address: fn(expr.address) };

    case ExpressionKind.Store:
      return {
        ...expr,
        address: fn(expr.address),
        value: fn(expr.value),
      };

    case ExpressionKind.MemoryGrow:
      return { ...expr, delta: fn(expr.delta) };

    case ExpressionKind.TableInit:
    case ExpressionKind.MemoryInit:
      return {
        ...expr,
        dest: fn(expr.dest),
        source: fn(expr.source),
        size: fn(expr.size),
      };

    // `data.drop` and `table.size` carry no child expressions — only an
    // immediate — so they are leaves here, listed rather than defaulted so that
    // a future kind cannot land in a silent catch-all.
    case ExpressionKind.DataDrop:
    case ExpressionKind.TableSize:
      return { ...expr };

    case ExpressionKind.TableGrow:
      return { ...expr, value: fn(expr.value), delta: fn(expr.delta) };

    case ExpressionKind.TableFill:
      return {
        ...expr,
        dest: fn(expr.dest),
        value: fn(expr.value),
        size: fn(expr.size),
      };

    case ExpressionKind.TableCopy:
      return {
        ...expr,
        dest: fn(expr.dest),
        source: fn(expr.source),
        size: fn(expr.size),
      };

    case ExpressionKind.MemoryCopy:
      return {
        ...expr,
        dest: fn(expr.dest),
        source: fn(expr.source),
        size: fn(expr.size),
      };

    case ExpressionKind.MemoryFill:
      return {
        ...expr,
        dest: fn(expr.dest),
        value: fn(expr.value),
        size: fn(expr.size),
      };

    case ExpressionKind.Call:
      return {
        ...expr,
        operands: expr.operands.map((o) => fn(o)),
      };

    case ExpressionKind.CallIndirect: {
      // Evaluation order is operands first, then the table index (target) last —
      // match wasm semantics so effect/eval-order-sensitive consumers (Flatten's
      // prelude hoisting, CFG construction) see children in the real order.
      const operands = expr.operands.map((o) => fn(o));
      const callee = fn(expr.callee);
      return { ...expr, callee, operands };
    }

    case ExpressionKind.RefIsNull:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.RefAs:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.RefEq:
      return {
        ...expr,
        left: fn(expr.left),
        right: fn(expr.right),
      };

    case ExpressionKind.RefI31:
    case ExpressionKind.AnyConvertExtern:
    case ExpressionKind.ExternConvertAny:
      return { ...expr, value: fn(expr.value) };

    case ExpressionKind.I31Get:
      return { ...expr, i31: fn(expr.i31) };

    case ExpressionKind.StructNew:
      return { ...expr, operands: expr.operands.map((o) => fn(o)) };

    case ExpressionKind.StructGet:
      return { ...expr, ref: fn(expr.ref) };

    case ExpressionKind.StructSet:
      return {
        ...expr,
        ref: fn(expr.ref),
        value: fn(expr.value),
      };

    case ExpressionKind.ArrayNew:
      return {
        ...expr,
        ...(expr.init === undefined ? {} : { init: fn(expr.init) }),
        length: fn(expr.length),
      };

    case ExpressionKind.ArrayNewFixed:
      return { ...expr, operands: expr.operands.map((v) => fn(v)) };

    case ExpressionKind.ArrayNewData:
    case ExpressionKind.ArrayNewElem:
      return {
        ...expr,
        offset: fn(expr.offset),
        length: fn(expr.length),
      };

    case ExpressionKind.ArrayGet:
      return {
        ...expr,
        ref: fn(expr.ref),
        index: fn(expr.index),
      };

    case ExpressionKind.ArraySet:
      return {
        ...expr,
        ref: fn(expr.ref),
        index: fn(expr.index),
        value: fn(expr.value),
      };

    case ExpressionKind.ArrayFill:
      return {
        ...expr,
        ref: fn(expr.ref),
        offset: fn(expr.offset),
        value: fn(expr.value),
        size: fn(expr.size),
      };

    case ExpressionKind.ArrayCopy:
      return {
        ...expr,
        destRef: fn(expr.destRef),
        destOffset: fn(expr.destOffset),
        srcRef: fn(expr.srcRef),
        srcOffset: fn(expr.srcOffset),
        size: fn(expr.size),
      };

    case ExpressionKind.ArrayInitData:
    case ExpressionKind.ArrayInitElem:
      return {
        ...expr,
        ref: fn(expr.ref),
        destOffset: fn(expr.destOffset),
        srcOffset: fn(expr.srcOffset),
        size: fn(expr.size),
      };

    case ExpressionKind.ArrayLen:
      return { ...expr, ref: fn(expr.ref) };

    case ExpressionKind.RefTest:
    case ExpressionKind.RefCast:
      return { ...expr, ref: fn(expr.ref) };

    case ExpressionKind.BrOn:
      // Values before the ref: the order wasm evaluates them in.
      return { ...expr, values: expr.values.map(fn), ref: fn(expr.ref) };

    case ExpressionKind.TryTable:
      return {
        ...expr,
        ...mappedParams(expr.params, fn),
        body: slot(expr.body),
      };

    case ExpressionKind.Try:
      return {
        ...expr,
        ...mappedParams(expr.params, fn),
        body: slot(expr.body),
        catches: expr.catches.map((c) => ({ ...c, body: slot(c.body) })),
      };

    case ExpressionKind.Throw:
      return { ...expr, operands: expr.operands.map((o) => fn(o)) };

    case ExpressionKind.ThrowRef:
      return { ...expr, exnref: fn(expr.exnref) };

    case ExpressionKind.SIMDExtract:
      return {
        ...(expr as SIMDExtractExpr),
        vec: fn((expr as SIMDExtractExpr).vec),
      };

    case ExpressionKind.SIMDReplace: {
      const e = expr as SIMDReplaceExpr;
      return { ...e, vec: fn(e.vec), value: fn(e.value) };
    }

    case ExpressionKind.SIMDShuffle: {
      const e = expr as SIMDShuffleExpr;
      return { ...e, left: fn(e.left), right: fn(e.right) };
    }

    case ExpressionKind.Quaternary: {
      const e = expr as QuaternaryExpr;
      return {
        ...e,
        a: fn(e.a),
        b: fn(e.b),
        c: fn(e.c),
        d: fn(e.d),
      };
    }
    case ExpressionKind.SIMDTernary: {
      const e = expr as SIMDTernaryExpr;
      return {
        ...e,
        a: fn(e.a),
        b: fn(e.b),
        c: fn(e.c),
      };
    }

    case ExpressionKind.SIMDLoad:
      return { ...(expr as SIMDLoadExpr), address: fn((expr as SIMDLoadExpr).address) };

    case ExpressionKind.SIMDLoadStoreLane: {
      const e = expr as SIMDLoadStoreLaneExpr;
      return { ...e, address: fn(e.address), vec: fn(e.vec) };
    }

    // Leaf nodes — no children to transform
    case ExpressionKind.Nop:
    case ExpressionKind.Unreachable:
    case ExpressionKind.Const:
    case ExpressionKind.LocalGet:
    case ExpressionKind.GlobalGet:
    case ExpressionKind.MemorySize:
    case ExpressionKind.RefNull:
    case ExpressionKind.RefFunc:
    case ExpressionKind.Rethrow:
    case ExpressionKind.Pop:
      return expr;

    default:
      // Every constructed ExpressionKind is handled above (an explicit case or
      // a listed leaf). Reaching here means a new/placeholder kind was wired
      // into the IR without a walk case — silently passing it through would
      // hide its children from every pass (DCE / CSE / liveness), a miscompile.
      // Fail loudly at the moment the kind is introduced instead.
      throw new Error(
        `mapExpression: unhandled expression kind "${(expr as { kind: string }).kind}" ` +
          `(add a case to _mapChildren in walk.ts)`,
      );
  }
}

// ---------------------------------------------------------------------------
// Internal: visit children (pre-order helper)
// ---------------------------------------------------------------------------

function _visitChildren(
  expr: Expression,
  visit: (child: Expression) => void,
): void {
  switch (expr.kind) {
    // A carrier's parameter values come first: they are evaluated before it.
    case ExpressionKind.Block:
      expr.params?.values.forEach(visit);
      expr.children.forEach(visit);
      break;
    case ExpressionKind.Region:
      expr.children.forEach(visit);
      break;
    case ExpressionKind.If:
      expr.params?.values.forEach(visit);
      visit(expr.condition);
      visit(expr.ifTrue);
      if (expr.ifFalse) visit(expr.ifFalse);
      break;
    case ExpressionKind.Loop:
      expr.params?.values.forEach(visit);
      visit(expr.body);
      break;
    // ⚠️ Condition before values — see the same note in `mapExpression`.
    case ExpressionKind.Break:
      if (expr.condition) visit(expr.condition);
      expr.values.forEach(visit);
      break;
    case ExpressionKind.Switch:
      visit(expr.condition);
      expr.values.forEach(visit);
      break;
    case ExpressionKind.Return:
      expr.values.forEach(visit);
      break;
    case ExpressionKind.LocalSet:
    case ExpressionKind.LocalTee:
      visit(expr.value);
      break;
    case ExpressionKind.TableGet:
      visit(expr.index);
      break;
    case ExpressionKind.TableSet:
      visit(expr.index);
      visit(expr.value);
      break;
    case ExpressionKind.GlobalSet:
      visit(expr.value);
      break;
    case ExpressionKind.Unary:
      visit(expr.value);
      break;
    case ExpressionKind.Binary:
      visit(expr.left);
      visit(expr.right);
      break;
    case ExpressionKind.Select:
      visit(expr.val1);
      visit(expr.val2);
      visit(expr.condition);
      break;
    case ExpressionKind.Drop:
      visit(expr.value);
      break;
    case ExpressionKind.Load:
      visit(expr.address);
      break;
    case ExpressionKind.Store:
      visit(expr.address);
      visit(expr.value);
      break;
    case ExpressionKind.MemoryGrow:
      visit(expr.delta);
      break;
    case ExpressionKind.TableInit:
    case ExpressionKind.MemoryInit:
      visit(expr.dest);
      visit(expr.source);
      visit(expr.size);
      break;
    case ExpressionKind.ElemDrop:
    case ExpressionKind.DataDrop:
    case ExpressionKind.TableSize:
      break; // immediates only, no children
    case ExpressionKind.TableGrow:
      visit(expr.value);
      visit(expr.delta);
      break;
    case ExpressionKind.TableFill:
      visit(expr.dest);
      visit(expr.value);
      visit(expr.size);
      break;
    case ExpressionKind.TableCopy:
      visit(expr.dest);
      visit(expr.source);
      visit(expr.size);
      break;
    case ExpressionKind.MemoryCopy:
      visit(expr.dest);
      visit(expr.source);
      visit(expr.size);
      break;
    case ExpressionKind.MemoryFill:
      visit(expr.dest);
      visit(expr.value);
      visit(expr.size);
      break;
    case ExpressionKind.Call:
      expr.operands.forEach(visit);
      break;
    case ExpressionKind.CallIndirect:
      // Operands evaluate before the table index (the callee) — visit in that order.
      expr.operands.forEach(visit);
      visit(expr.callee);
      break;
    case ExpressionKind.RefIsNull:
      visit(expr.value);
      break;

    case ExpressionKind.RefAs:
      visit(expr.value);
      break;

    case ExpressionKind.RefEq:
      visit(expr.left);
      visit(expr.right);
      break;
    case ExpressionKind.RefI31:
    case ExpressionKind.AnyConvertExtern:
    case ExpressionKind.ExternConvertAny:
      visit(expr.value);
      break;
    case ExpressionKind.I31Get:
      visit(expr.i31);
      break;
    case ExpressionKind.StructNew:
      expr.operands.forEach(visit);
      break;
    case ExpressionKind.StructGet:
      visit(expr.ref);
      break;
    case ExpressionKind.StructSet:
      visit(expr.ref);
      visit(expr.value);
      break;
    case ExpressionKind.ArrayNew:
      if (expr.init) visit(expr.init);
      visit(expr.length);
      break;
    case ExpressionKind.ArrayNewFixed:
      expr.operands.forEach(visit);
      break;
    case ExpressionKind.ArrayNewData:
    case ExpressionKind.ArrayNewElem:
      visit(expr.offset);
      visit(expr.length);
      break;
    case ExpressionKind.ArrayGet:
      visit(expr.ref);
      visit(expr.index);
      break;
    case ExpressionKind.ArraySet:
      visit(expr.ref);
      visit(expr.index);
      visit(expr.value);
      break;
    case ExpressionKind.ArrayFill:
      visit(expr.ref);
      visit(expr.offset);
      visit(expr.value);
      visit(expr.size);
      break;
    case ExpressionKind.ArrayCopy:
      visit(expr.destRef);
      visit(expr.destOffset);
      visit(expr.srcRef);
      visit(expr.srcOffset);
      visit(expr.size);
      break;
    case ExpressionKind.ArrayInitData:
    case ExpressionKind.ArrayInitElem:
      visit(expr.ref);
      visit(expr.destOffset);
      visit(expr.srcOffset);
      visit(expr.size);
      break;
    case ExpressionKind.ArrayLen:
    case ExpressionKind.RefTest:
    case ExpressionKind.RefCast:
      visit(expr.ref);
      break;
    case ExpressionKind.BrOn:
      // Values before the ref: the order wasm evaluates them in.
      expr.values.forEach(visit);
      visit(expr.ref);
      break;
    case ExpressionKind.TryTable:
      expr.params?.values.forEach(visit);
      visit(expr.body);
      break;
    case ExpressionKind.Try:
      expr.params?.values.forEach(visit);
      visit(expr.body);
      expr.catches.forEach((c) => visit(c.body));
      break;
    case ExpressionKind.Throw:
      expr.operands.forEach(visit);
      break;
    case ExpressionKind.ThrowRef:
      visit(expr.exnref);
      break;
    case ExpressionKind.SIMDExtract:
      visit((expr as SIMDExtractExpr).vec);
      break;
    case ExpressionKind.SIMDReplace: {
      const e = expr as SIMDReplaceExpr;
      visit(e.vec);
      visit(e.value);
      break;
    }
    case ExpressionKind.SIMDShuffle: {
      const e = expr as SIMDShuffleExpr;
      visit(e.left);
      visit(e.right);
      break;
    }
    case ExpressionKind.Quaternary: {
      const e = expr as QuaternaryExpr;
      visit(e.a);
      visit(e.b);
      visit(e.c);
      visit(e.d);
      break;
    }
    case ExpressionKind.SIMDTernary: {
      const e = expr as SIMDTernaryExpr;
      visit(e.a);
      visit(e.b);
      visit(e.c);
      break;
    }
    case ExpressionKind.SIMDLoad:
      visit((expr as SIMDLoadExpr).address);
      break;
    case ExpressionKind.SIMDLoadStoreLane: {
      const e = expr as SIMDLoadStoreLaneExpr;
      visit(e.address);
      visit(e.vec);
      break;
    }

    // Leaf nodes — no children to visit.
    case ExpressionKind.Nop:
    case ExpressionKind.Unreachable:
    case ExpressionKind.Const:
    case ExpressionKind.LocalGet:
    case ExpressionKind.GlobalGet:
    case ExpressionKind.MemorySize:
    case ExpressionKind.RefNull:
    case ExpressionKind.RefFunc:
    case ExpressionKind.Rethrow:
    case ExpressionKind.Pop:
      break;

    default:
      // As in _mapChildren: every constructed kind is handled above, so this is
      // reached only by a new/placeholder kind with no walk case. Failing loudly
      // prevents a pass from silently skipping the subtree.
      throw new Error(
        `walkExpression: unhandled expression kind "${(expr as { kind: string }).kind}" ` +
          `(add a case to _visitChildren in walk.ts)`,
      );
  }
}
