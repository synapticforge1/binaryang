// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module ir/nesting
 *
 * ONE nesting limit, the same on every runtime (owner, 2026-11-13: option 1 of the depth report,
 * "now, and then option 2 in the stage by stage plan").
 *
 * The parser, the writers, the validator, the passes and the interpreter recurse once per level
 * of an expression tree, so how deep a module could be depended on the host's JavaScript stack:
 * measured 2026-11-13 (Windows, a fresh process per probe), the lowest stage accepted 425 levels on
 * Node 22.18 / 24 / 26 and Deno, and 5,794 on Bun 1.4.4 — and on Node one module at one depth was
 * refused cold and accepted once the JIT had warmed. A limit that moves with the runtime and the
 * run is no limit. So every entry point MEASURES the depth without recursing ({@link nestingDepth})
 * and refuses past {@link MAX_NESTING_DEPTH}, in the same words everywhere.
 *
 * 256 sits under the lowest measured capacity (425) with room for a caller's own stack, and is
 * 6–10 times the deepest real module measured (25 levels in 421 real-compiler modules, 40 in the
 * spec testsuite). Option 2 — the recursive stages made iterative, lowest ceiling first — raises
 * it stage by stage; until then this is the promise, and `nesting_limit.test.ts` holds every
 * stage to it on every runtime CI runs.
 *
 * DEPTH counts every expression level, operands included: `(i32.add (i32.add …))` nests as
 * `(block (block …))` does, and a long operand chain was the lowest ceiling of all.
 *
 * @license MIT
 */

import type { Expression } from './expressions.ts';
import type { Module } from './ir.ts';
import { visitChildren } from './walk.ts';

/** The deepest expression nesting binaryang accepts, on every runtime. */
export const MAX_NESTING_DEPTH = 256;

/** The words every refusal of {@link MAX_NESTING_DEPTH} uses. */
export const NESTING_OVER_LIMIT =
  `the module nests deeper than ${MAX_NESTING_DEPTH} levels, binaryang's limit on every runtime`;

/**
 * How far subtrees shared by reference may EXPAND a module: every walk visits a shared node once
 * per path to it, so a module of U distinct expression nodes is walked as W. It may be walked as
 * at most `2U + MAX_SHARED_SLACK` — a pass or an API user may reuse a node here and there
 * (Flatten and the custom-page-size lowering do; binaryen.js code does `i32.add(x, x)`), and that
 * costs one more visit per use. The API can instead build an expansion with no bound: one node as
 * both operands of the next, k times, is walked 2^k times — the depth check took 719 ms at k = 24
 * and would never finish at 40; one such subtree as the body of 400 functions took 34 s to check
 * and 6.9 GB to write (security review round 3, class 1, 2026-11-13). W is found without
 * expanding anything (each distinct node's expanded size, remembered), so the check costs one
 * visit per distinct node.
 */
export const MAX_SHARED_SLACK = 1_000_000;

/** The refusal of an expansion past {@link MAX_SHARED_SLACK}: how far, in numbers. */
export function subtreesExpand(walked: number, distinct: number): string {
  return `subtrees shared by reference expand the module to ${walked} expression nodes as walked, ` +
    `from ${distinct} distinct (the limit: twice the distinct, plus ${MAX_SHARED_SLACK})`;
}

/** The refusal of a cycle: an expression that contains itself, which no walk can finish. */
export const EXPRESSION_CYCLE = 'an expression contains itself (a cycle): no walk of it can end';

/** A module past a limit, given to a stage that throws (the passes); the message says which. */
export class NestingLimitError extends Error {
  constructor(where: string, problem: string = NESTING_OVER_LIMIT) {
    super(`${where}: ${problem}`);
    this.name = 'NestingLimitError';
  }
}

/**
 * How deep `root` nests, WITHOUT recursing (an explicit stack), so it measures what would run a
 * recursive stage out of stack. A function body's region is not a level; each expression in it
 * is level 1. Stops once past `stopAbove`, returning a value above it. For a FRESH tree (the
 * reader's, the parser's): on a module the API built, use {@link moduleLimitProblem}, which a
 * shared subtree cannot expand.
 */
export function nestingDepth(root: Expression, stopAbove = Infinity): number {
  const nodes: Expression[] = [];
  const depths: number[] = [];
  const push = (e: Expression, d: number) => {
    nodes.push(e);
    depths.push(d);
  };
  if (root.kind === 'region') visitChildren(root, (c) => push(c, 1));
  else push(root, 1);
  let max = 0;
  while (nodes.length > 0) {
    const e = nodes.pop()!;
    const d = depths.pop()!;
    if (d > max) {
      max = d;
      if (max > stopAbove) return max;
    }
    visitChildren(e, (c) => push(c, d + 1));
  }
  return max;
}

/**
 * What is wrong with one FRESH tree (the reader's, the parser's: they cannot share a node) — its
 * depth past {@link MAX_NESTING_DEPTH} — or `undefined`.
 */
export function limitProblem(root: Expression | undefined): string | undefined {
  if (root === undefined) return undefined;
  return nestingDepth(root, MAX_NESTING_DEPTH) > MAX_NESTING_DEPTH ? NESTING_OVER_LIMIT : undefined;
}

/** Whether a fresh tree is past the limit ({@link limitProblem}). */
export function tooDeep(root: Expression | undefined): boolean {
  return limitProblem(root) !== undefined;
}

/**
 * Every expression a module holds: function bodies, initialisers, segment offsets and items —
 * and the same fields of what it IMPORTS (a `Func`, `Global` or `Table` import may carry them, and
 * the writers copy them: the second class-1 retest hung a shared subtree there).
 */
function* regionsOf(m: Module): Generator<Expression> {
  for (const f of m.functions) yield f.body;
  for (const g of m.globals) if (g.init !== undefined) yield g.init;
  for (const t of m.tables) if (t.init !== undefined) yield t.init;
  for (const e of m.elements) {
    if (e.offset !== undefined) yield e.offset;
    yield* e.elemExprs;
  }
  for (const d of m.dataSegments) if (d.offset !== undefined) yield d.offset;
  for (const i of m.imports) {
    const held = i as {
      func?: { body?: Expression };
      global?: { init?: Expression };
      table?: { init?: Expression };
    };
    if (held.func?.body !== undefined) yield held.func.body;
    if (held.global?.init !== undefined) yield held.global.init;
    if (held.table?.init !== undefined) yield held.table.init;
  }
}

/** A node's remembered measure: its expanded size × 512 + its height (height ≤ 257 here). */
const PENDING = -1;
const pack = (size: number, height: number) => size * 512 + height;
const sizeOf = (v: number) => Math.floor(v / 512);
const heightOf = (v: number) => v % 512;

/**
 * Each distinct node's expanded size and height, without expanding (`memo`). Returns
 * `[size, height]` for `root`, `'deep'` past {@link MAX_NESTING_DEPTH}, or `'cycle'`.
 */
function measure(
  root: Expression,
  memo: Map<Expression, number>,
): [number, number] | 'deep' | 'cycle' {
  const known = memo.get(root);
  if (known === PENDING) return 'cycle';
  if (known !== undefined) return [sizeOf(known), heightOf(known)];
  const nodes: Expression[] = [root];
  const kids: Expression[][] = [];
  const next: number[] = [0];
  const size: number[] = [1];
  const height: number[] = [0];
  const childrenOf = (e: Expression) => {
    const out: Expression[] = [];
    visitChildren(e, (c) => out.push(c));
    return out;
  };
  kids.push(childrenOf(root));
  memo.set(root, PENDING);
  while (nodes.length > 0) {
    const top = nodes.length - 1;
    // A region (a function body) is not a level; every other node is one.
    if (nodes.length > MAX_NESTING_DEPTH + 2) return 'deep';
    if (next[top]! < kids[top]!.length) {
      const c = kids[top]![next[top]!++]!;
      const m = memo.get(c);
      if (m === PENDING) return 'cycle';
      if (m !== undefined) {
        size[top]! += sizeOf(m);
        height[top] = Math.max(height[top]!, heightOf(m));
        continue;
      }
      memo.set(c, PENDING);
      nodes.push(c);
      kids.push(childrenOf(c));
      next.push(0);
      size.push(1);
      height.push(0);
      continue;
    }
    const e = nodes.pop()!;
    kids.pop();
    next.pop();
    const s = size.pop()!;
    const h = height.pop()! + (e.kind === 'region' ? 0 : 1);
    if (h > MAX_NESTING_DEPTH) return 'deep';
    memo.set(e, pack(s, h));
    if (nodes.length > 0) {
      const p = nodes.length - 1;
      size[p]! += s;
      height[p] = Math.max(height[p]!, h);
    } else return [s, h];
  }
  return [0, 0];
}

/**
 * What is wrong with ANY module — an expression past {@link MAX_NESTING_DEPTH}, a cycle, or
 * subtrees shared so widely that walking it costs past `2U + MAX_SHARED_SLACK`
 * ({@link subtreesExpand}) — or `undefined`. One walk over the whole module, each DISTINCT node
 * visited once: a subtree shared between functions is measured as surely as one within a function.
 */
export function moduleLimitProblem(m: Module): string | undefined {
  const memo = new Map<Expression, number>();
  let walked = 0;
  for (const r of regionsOf(m)) {
    const res = measure(r, memo);
    if (res === 'deep') return NESTING_OVER_LIMIT;
    if (res === 'cycle') return EXPRESSION_CYCLE;
    walked += res[0];
  }
  const distinct = memo.size;
  return walked > 2 * distinct + MAX_SHARED_SLACK ? subtreesExpand(walked, distinct) : undefined;
}

/** Whether `m` is past a limit ({@link moduleLimitProblem}). */
export function moduleTooDeep(m: Module): boolean {
  return moduleLimitProblem(m) !== undefined;
}

/** Throws {@link NestingLimitError} when `m` is past a limit: for a stage given a module it did not read. */
export function requireNestingWithinLimit(m: Module, where: string): void {
  const p = moduleLimitProblem(m);
  if (p !== undefined) throw new NestingLimitError(where, p);
}
