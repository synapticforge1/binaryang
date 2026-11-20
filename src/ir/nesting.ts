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
 * THE UNIT — what counts as one level (README § "Limits on untrusted input" says the same):
 * the depth of the expression tree as the IR holds it. Every expression NODE on a path counts as
 * one: a `block`, `loop`, `if`, `try` and `try_table`, and equally every operand —
 * `(i32.add (i32.add …))` nests as `(block (block …))` does, an `if`'s condition is one level
 * under it, a code-metadata annotation is one level under the node holding it. The first
 * instruction of a function body (or an initialiser) is level 1. NOT counted: the body itself, an
 * arm of an `if` or the body of a `try` / catch (a region is a list, not a node), and how a level
 * was written — folded `(block (block …))`, linear `block block … end end` and an unparenthesised
 * operand chain (`i32.const 1 … i32.add …`) are the same depth. `(drop (i32.add (i32.const 0)
 * (i32.const 1)))` is 3. A long operand chain was the lowest ceiling of all.
 *
 * WHERE it is held: at every entry that recurses — the readers, the parser (a token pre-scan,
 * then the built tree), the writers, the pass runner (at its entry and AFTER EACH PASS: a pass can
 * deepen a module), `createPass().run`, `resolveNames`, `validateModule`, `ExprVisitor`, the
 * interpreter and the bundler.
 *
 * @license MIT
 */

import type { Expression } from './expressions.ts';
import { FidelityTable } from './fidelity.ts';
import type { Module } from './ir.ts';
import { visitChildren } from './walk.ts';

/**
 * The deepest expression nesting binaryang accepts, on every runtime: the most expression NODES on
 * one path from a body or initialiser to a leaf (see "THE UNIT" in the module doc: blocks, loops,
 * ifs, trys and try_tables count, and so does every operand, folded or not; the body itself, an
 * arm and a catch body, which are lists, do not).
 */
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
  // A REGION (a body, an `if` arm, a `loop` or `try` body) is a list, not a level: its children
  // are one level under the node that holds it, as {@link measure} counts them. 🔧 Only the root
  // region was skipped, so the reader and the parser counted a `loop`, an `if` and a `try` as TWO
  // levels and refused 129 of them nested, where the writers, the passes and the interpreter
  // accept 256 (C-H5, 2026-11-20).
  const pushChildren = (e: Expression, d: number) => {
    visitChildren(e, (c) => {
      if (c.kind === 'region') pushChildren(c, d);
      else push(c, d + 1);
    });
  };
  if (root.kind === 'region') pushChildren(root, 0);
  else push(root, 1);
  let max = 0;
  while (nodes.length > 0) {
    const e = nodes.pop()!;
    const d = depths.pop()!;
    if (d > max) {
      max = d;
      if (max > stopAbove) return max;
    }
    pushChildren(e, d);
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
export function* regionsOf(m: Module): Generator<Expression> {
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

/**
 * A node's remembered measure: its expanded size × 512 + its height (height ≤ 257 here). Sizes
 * saturate at 2^40 — far past any bound, so nothing that big is ever accepted — which keeps the
 * packed number under 2^53, exact: 🔧 unsaturated, a 2^52 expansion lost its height and was
 * refused in the depth limit's words (class 1's third retest, 2026-11-15).
 */
const PENDING = -1;
const SIZE_CAP = 2 ** 40;
const capped = (size: number) => (size > SIZE_CAP ? SIZE_CAP : size);
const pack = (size: number, height: number) => capped(size) * 512 + height;
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
  // The LEVELS on the path so far — regions are not levels — so a walk stops as soon as it is past
  // the limit, by the same count the heights use. 🔧 It counted the stack, regions included, so a
  // nest of `if`s (a region per arm) stopped at ~129 though its height was within 256.
  const levels: number[] = [root.kind === 'region' ? 0 : 1];
  const childrenOf = (e: Expression) => {
    const out: Expression[] = [];
    visitChildren(e, (c) => out.push(c));
    return out;
  };
  kids.push(childrenOf(root));
  memo.set(root, PENDING);
  while (nodes.length > 0) {
    const top = nodes.length - 1;
    if (next[top]! < kids[top]!.length) {
      const c = kids[top]![next[top]!++]!;
      const m = memo.get(c);
      if (m === PENDING) return 'cycle';
      if (m !== undefined) {
        size[top] = capped(size[top]! + sizeOf(m));
        height[top] = Math.max(height[top]!, heightOf(m));
        continue;
      }
      // A region (a function body, an arm) is not a level; every other node is one.
      const level = levels[top]! + (c.kind === 'region' ? 0 : 1);
      if (level > MAX_NESTING_DEPTH) return 'deep';
      memo.set(c, PENDING);
      nodes.push(c);
      kids.push(childrenOf(c));
      next.push(0);
      size.push(1);
      height.push(0);
      levels.push(level);
      continue;
    }
    const e = nodes.pop()!;
    kids.pop();
    next.pop();
    levels.pop();
    const s = size.pop()!;
    const h = height.pop()! + (e.kind === 'region' ? 0 : 1);
    if (h > MAX_NESTING_DEPTH) return 'deep';
    memo.set(e, pack(s, h));
    if (nodes.length > 0) {
      const p = nodes.length - 1;
      size[p] = capped(size[p]! + s);
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
  return moduleShape(m).problem;
}

/** What {@link modulesShape} finds. */
export interface ModuleShape {
  /** The limit passed, in its own words, or `undefined`. */
  problem?: string;
  /** Expression nodes as walked, and distinct: `walked > distinct` when a node is reused. */
  walked: number;
  distinct: number;
}

/**
 * The EXPRESSION part of {@link modulesShape} alone — depth, a cycle, sharing — without the held
 * data's walk, so it is cheap enough to run after every pass (the pass runner's re-check: a pass
 * can deepen a module past the limit, Inlining nests a callee's body inside the call site's).
 */
export function expressionShape(ms: readonly Module[]): ModuleShape {
  const memo = new Map<Expression, number>();
  let walked = 0;
  for (const m of ms) {
    for (const r of regionsOf(m)) {
      const res = measure(r, memo);
      if (res === 'deep') return { problem: NESTING_OVER_LIMIT, walked, distinct: memo.size };
      if (res === 'cycle') return { problem: EXPRESSION_CYCLE, walked, distinct: memo.size };
      walked += res[0];
    }
  }
  const distinct = memo.size;
  if (walked > 2 * distinct + MAX_SHARED_SLACK) {
    return { problem: subtreesExpand(walked, distinct), walked, distinct };
  }
  return { walked, distinct };
}

/** The module's {@link moduleLimitProblem}, with its expression nodes as walked and distinct. */
export function moduleShape(m: Module): ModuleShape {
  return modulesShape([m]);
}

/**
 * {@link moduleShape} for several modules TOGETHER — one call's inputs (the bundler's): what they
 * share between them is measured once, so one module given as many inputs is bounded by what it
 * holds, not by how many times it is given (class 1's eighth retest).
 */
export function modulesShape(ms: readonly Module[]): ModuleShape {
  const shape = expressionShape(ms);
  if (shape.problem !== undefined) return shape;
  const { walked, distinct } = shape;
  const data = heldData(ms);
  return data.problem === undefined
    ? { walked, distinct }
    : { problem: data.problem, walked, distinct };
}

/**
 * The slack for EVERYTHING a module holds, not only its expressions, in ENTRIES (an object and
 * each field, element or entry it holds — {@link dataWork}): an expression node is several (a
 * constant is the node and its value; a `br_table` holds its targets), so the expression bound's
 * {@link MAX_SHARED_SLACK} is scaled by 8. 🔧 At 16× a refusal took 6.5 s on V8 to reach (class
 * 1's third retest, 2026-11-15).
 */
export const DATA_SHARED_SLACK = 8 * MAX_SHARED_SLACK;

/** The refusal of shared data — a type list, a location, any object — expanded past the bound. */
export function dataExpands(walked: number, held: number): string {
  return `objects shared by reference expand the module to ${walked} entries as walked, ` +
    `from ${held} held (the limit: twice the held, plus ${DATA_SHARED_SLACK})`;
}

/** The refusal of a sparse array: its `length` says more than it holds, and a copy fills it. */
export const SPARSE_ARRAY =
  'an array in the module has a hole (a sparse array): its length is not what it holds';

/**
 * The refusal of a number no WebAssembly value needs: every `bigint` the IR holds is 64 bits
 * (an `i64`, an `f64`'s bits, a memory offset). 🔧 One million-bit `i64.const` value under 200
 * functions cost `writeWat` 9.2 s, written per use and counted as nothing (class 1's seventh
 * retest, 2026-11-15).
 */
export const WIDE_NUMBER =
  'a number in the module is wider than 64 bits, as no WebAssembly value is';
const WIDEST = 1n << 64n;

/**
 * How deep a module's DATA may nest, object in object: six objects per expression level under
 * {@link MAX_NESTING_DEPTH}. The deepest level is a `try` in a `catch` — the try, its `catches`,
 * the catch, its body, the body's list: five (🔧 at four, plain trees of 210 such levels, under the
 * nesting limit, were refused: the review of class 1's fixes, 2026-11-15); an `if` is three, a
 * block two. The copies (the writers', the optimizer's unshare) recurse once per object, so this
 * bounds them as the nesting limit bounds the stages: V8 ran a copy out of stack near 2,750 (🔧 a
 * chain of 100,000 plain objects hung on a reused node did, a bare RangeError: class 1's tenth
 * retest). Kept under 2,048, the packed memo's height field.
 */
export const MAX_DATA_DEPTH = 6 * MAX_NESTING_DEPTH;

/** The refusal of data nested past {@link MAX_DATA_DEPTH}. */
export const DATA_TOO_DEEP =
  `the module's data nests deeper than ${MAX_DATA_DEPTH} objects, binaryang's limit on every runtime`;

/** The refusal of a cycle through data that is not an expression. */
export const DATA_CYCLE =
  'an object in the module contains itself (a cycle): no copy of it can end';

/**
 * What visiting, copying or writing `v` once costs: the object and each entry it holds; a byte
 * view, its bytes (shared by the copy, but written once per use); a fidelity table, its entries
 * and its empty rec groups (the clone copies both). 🔧 A shared `Uint8Array` as the data of 64
 * segments wrote 537 MB from 8 MB held; a table's rec groups, cloned per path, went uncounted;
 * a `Uint16Array` was walked an element at a time, 4.8 s at 5M (class 1's sixth retest).
 */
export function dataWork(v: object): number {
  if (ArrayBuffer.isView(v)) return 1 + v.byteLength;
  if (Array.isArray(v)) return 1 + v.length;
  if (v instanceof Map || v instanceof Set) return 1 + v.size;
  if (v instanceof FidelityTable) return 1 + v.size + v.emptyRecGroups.length;
  return 1 + Object.keys(v).length;
}

/**
 * A string's length past this is work, counted wherever it is used: a string is a value, so one
 * held once and used a million times cannot be told from a million strings — but its bytes are
 * written per use (🔧 one 4 MB export name under 100 exports wrote 419 MB: class 1's sixth
 * retest). Names up to this long are free — far past any real name — so text that calls a long
 * name many times costs nothing extra (🔧 at 256, a WAT module calling one 1,000-character name
 * 20,000 times was refused, though the text held every copy: the review of class 1's fixes);
 * past it, a string costs what it writes, bounded with everything else.
 */
export const FREE_STRING_LENGTH = 65_536;
const stringWork = (
  s: string,
) => (s.length > FREE_STRING_LENGTH ? s.length - FREE_STRING_LENGTH : 0);

/** The values `v` holds, or `'sparse'` at its first hole (so the scan costs what is held). */
function dataChildren(v: object): unknown[] | 'sparse' {
  if (ArrayBuffer.isView(v)) return []; // a leaf: its bytes are its work
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!(i in v)) return 'sparse';
    return v;
  }
  if (v instanceof Map || v instanceof Set) return [...v.values()];
  if (v instanceof FidelityTable) return v.entryValues();
  return Object.values(v);
}

/**
 * What is wrong with the DATA a module holds, every object in it and not only the expressions:
 * a sparse array, a cycle, or objects shared so widely that a walk or a copy per path passes
 * twice what is held plus {@link DATA_SHARED_SLACK}. Each distinct object's expanded work is
 * remembered, so the check costs what the module holds. 🔧 Only expressions were measured, so one
 * shared array of a million types under 160 blocks cost an optimizer run 3.8 s and 8.8 GB, and a
 * one-entry array at index 4e8 ran the writer's copy out of memory (class 1's fifth retest,
 * 2026-11-15).
 */
export function heldDataProblem(m: Module): string | undefined {
  return heldData(m).problem;
}

/** {@link heldDataProblem}'s walk from any root: the problem, the work as walked, and as held. */
function heldData(root: object): { problem?: string; total: number; held: number } {
  const r = heldDataWalk(root);
  return typeof r === 'string' ? { problem: r, total: 0, held: 0 } : r;
}

function heldDataWalk(root: object): string | { problem?: string; total: number; held: number } {
  // Each finished object's expanded WORK and HEIGHT (itself and the deepest chain under it),
  // packed in one number (work ≤ 2^40, height ≤ MAX_DATA_DEPTH < 2048), so one reached again by
  // a deeper path is held to the depth limit there too. 🔧 Depth was checked on the path that
  // found an object first, so chains of chains, each found shallow, nested 40,000 deep under the
  // limit and ran the copies out of stack (class 1's eleventh retest, 2026-11-15).
  const memo = new Map<object, number>();
  const strings = new Set<string>();
  let held = 0;
  const objects: object[] = [];
  const kids: unknown[][] = [];
  const next: number[] = [];
  const work: number[] = [];
  const heights: number[] = [];
  const enter = (v: object): string | undefined => {
    if (objects.length >= MAX_DATA_DEPTH) return DATA_TOO_DEEP;
    const c = dataChildren(v);
    if (c === 'sparse') return SPARSE_ARRAY;
    const w = dataWork(v);
    held += w;
    memo.set(v, PENDING);
    objects.push(v);
    kids.push(c);
    next.push(0);
    work.push(w);
    heights.push(1);
    return undefined;
  };
  const first = enter(root);
  if (first !== undefined) return first;
  let total = 0;
  while (objects.length > 0) {
    const top = objects.length - 1;
    if (next[top]! < kids[top]!.length) {
      const c = kids[top]![next[top]!++];
      if (typeof c === 'string') {
        // Counted per use; the held side counts each distinct long string once.
        const w = stringWork(c);
        if (w > 0) {
          work[top] = capped(work[top]! + w);
          if (!strings.has(c)) {
            strings.add(c);
            held += w;
          }
        }
        continue;
      }
      if (typeof c === 'bigint') {
        if (c >= WIDEST || c <= -WIDEST) return WIDE_NUMBER;
        continue;
      }
      if (c === null || typeof c !== 'object') continue;
      const known = memo.get(c);
      if (known === PENDING) return DATA_CYCLE;
      if (known !== undefined) {
        const h = known % 2048;
        if (objects.length + h > MAX_DATA_DEPTH) return DATA_TOO_DEEP;
        work[top] = capped(work[top]! + Math.floor(known / 2048));
        heights[top] = Math.max(heights[top]!, h + 1);
        continue;
      }
      const p = enter(c);
      if (p !== undefined) return p;
      continue;
    }
    const v = objects.pop()!;
    kids.pop();
    next.pop();
    const w = work.pop()!;
    const h = heights.pop()!;
    memo.set(v, capped(w) * 2048 + h);
    if (objects.length > 0) {
      const p = objects.length - 1;
      work[p] = capped(work[p]! + w);
      heights[p] = Math.max(heights[p]!, h + 1);
    } else total = w;
  }
  return total > 2 * held + DATA_SHARED_SLACK
    ? { problem: dataExpands(total, held), total, held }
    : { total, held };
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
