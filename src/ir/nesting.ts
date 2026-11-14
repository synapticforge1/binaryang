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
 * The words the refusal of a SHARED subtree uses: one expression reachable along two paths (a
 * DAG), which only an API-built module can hold — bytes and WAT always make a tree. Every walk
 * expands a DAG, so one node used as both operands of the next, k times, is walked 2^k times:
 * the depth check took 719 ms at k = 24 and would never finish at 40, and one such subtree used
 * as the body of many functions ran the writer to 6.9 GB (security review round 3, class 1,
 * 2026-11-13). Upstream's validator refuses it too ("expression seen more than once"); no pass
 * here creates one (16,000 runs over 422 real modules, checked that day).
 */
export const SUBTREE_SHARED =
  "an expression appears more than once in the module (a subtree shared by reference): a module's " +
  'expressions must form a tree, as upstream requires';

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
 * is level 1. Stops once past `stopAbove`, returning a value above it.
 *
 * With `seen`, every node is recorded there, and one met a second time — in this tree or in an
 * earlier one checked against the same set — stops the walk with `-1`: a shared subtree. So a
 * DAG costs one visit per DISTINCT node, never its expansion.
 */
export function nestingDepth(
  root: Expression,
  stopAbove = Infinity,
  seen?: Set<Expression>,
): number {
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
    if (seen !== undefined) {
      if (seen.has(e)) return -1;
      seen.add(e);
    }
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

/** Every expression a module holds: function bodies, initialisers, segment offsets and items. */
function* regionsOf(m: Module): Generator<Expression> {
  for (const f of m.functions) yield f.body;
  for (const g of m.globals) if (g.init !== undefined) yield g.init;
  for (const t of m.tables) if (t.init !== undefined) yield t.init;
  for (const e of m.elements) {
    if (e.offset !== undefined) yield e.offset;
    yield* e.elemExprs;
  }
  for (const d of m.dataSegments) if (d.offset !== undefined) yield d.offset;
}

/**
 * What is wrong with ANY module — a node shared anywhere in it ({@link SUBTREE_SHARED}), or an
 * expression past {@link MAX_NESTING_DEPTH} — or `undefined`. One walk over the whole module with
 * one set of the nodes seen, so a subtree shared between two functions is caught as surely as one
 * shared within a function, and each distinct node is visited once.
 */
export function moduleLimitProblem(m: Module): string | undefined {
  const seen = new Set<Expression>();
  for (const r of regionsOf(m)) {
    const d = nestingDepth(r, MAX_NESTING_DEPTH, seen);
    if (d === -1) return SUBTREE_SHARED;
    if (d > MAX_NESTING_DEPTH) return NESTING_OVER_LIMIT;
  }
  return undefined;
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
