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
 * The most expression nodes one function's tree (or one initialiser) may hold, COUNTED AS WALKED:
 * a node reachable along two paths counts twice. Bytes and WAT always make a tree, where that is
 * the node count, and an engine refuses a function body over 7,654,321 bytes (the JS API's
 * limit), each node at least a byte — so nothing an engine runs is refused. The API can build a
 * DAG instead (one node as both operands of the next, k times), which every walk expands into 2^k
 * nodes: the depth check itself took 719 ms at k = 24 and would never finish at 40, and the
 * writers and passes after it expand it the same way (security review round 3, 2026-11-13).
 */
export const MAX_TREE_NODES = 8_000_000;

/** The words the refusal of {@link MAX_TREE_NODES} uses. */
export const TREE_OVER_LIMIT = `a function's expression tree expands past ${
  MAX_TREE_NODES.toLocaleString('en-US')
} nodes (a subtree shared by reference counts each time it is reached), binaryang's limit`;

/** A tree past a limit, given to a stage that throws (the passes); the message says which. */
export class NestingLimitError extends Error {
  constructor(where: string, problem: string = NESTING_OVER_LIMIT) {
    super(`${where}: ${problem}`);
    this.name = 'NestingLimitError';
  }
}

/**
 * How deep `root` nests, WITHOUT recursing (an explicit stack), so it measures what would run a
 * recursive stage out of stack. A function body's region is not a level; each expression in it
 * is level 1. Stops once past `stopAbove`, returning a value above it — and once the walk has
 * reached more than `maxNodes` nodes, returning `Infinity`.
 */
export function nestingDepth(root: Expression, stopAbove = Infinity, maxNodes = Infinity): number {
  const nodes: Expression[] = [];
  const depths: number[] = [];
  const push = (e: Expression, d: number) => {
    nodes.push(e);
    depths.push(d);
  };
  if (root.kind === 'region') visitChildren(root, (c) => push(c, 1));
  else push(root, 1);
  let max = 0;
  let reached = 0;
  while (nodes.length > 0) {
    const e = nodes.pop()!;
    const d = depths.pop()!;
    if (++reached > maxNodes) return Infinity;
    if (d > max) {
      max = d;
      if (max > stopAbove) return max;
    }
    visitChildren(e, (c) => push(c, d + 1));
  }
  return max;
}

/**
 * What is wrong with `root` against the limits — {@link NESTING_OVER_LIMIT} or
 * {@link TREE_OVER_LIMIT} — or `undefined`. One walk, bounded by both.
 */
export function limitProblem(root: Expression | undefined): string | undefined {
  if (root === undefined) return undefined;
  const d = nestingDepth(root, MAX_NESTING_DEPTH, MAX_TREE_NODES);
  if (d === Infinity) return TREE_OVER_LIMIT;
  return d > MAX_NESTING_DEPTH ? NESTING_OVER_LIMIT : undefined;
}

/** Whether `root` is past a limit ({@link limitProblem}). */
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

/** The first limit any expression in `m` is past ({@link limitProblem}), or `undefined`. */
export function moduleLimitProblem(m: Module): string | undefined {
  for (const r of regionsOf(m)) {
    const p = limitProblem(r);
    if (p !== undefined) return p;
  }
  return undefined;
}

/** Whether any expression in `m` is past a limit. */
export function moduleTooDeep(m: Module): boolean {
  return moduleLimitProblem(m) !== undefined;
}

/** Throws {@link NestingLimitError} when `m` is past a limit: for a stage given a module it did not read. */
export function requireNestingWithinLimit(m: Module, where: string): void {
  const p = moduleLimitProblem(m);
  if (p !== undefined) throw new NestingLimitError(where, p);
}
