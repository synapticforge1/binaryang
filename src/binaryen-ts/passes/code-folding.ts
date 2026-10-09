/**
 * @module binaryen-ts/passes/code-folding
 *
 * CodeFolding (open-work 2, step 6c, 2026-10-08): code that both arms of an
 * `if` end with is written once, after the `if`:
 *
 *     (if c (then A… T…) (else B… T…))   →   (if c (then A…) (else B…)) T…
 *
 * The tail `T…` is the longest run of statements, from each arm's end, that
 * are STRUCTURALLY EQUAL in both (immediates, types and operands alike, as
 * LocalCSE keys a node), and that can leave the arm:
 *
 * - it holds no `pop` — a stack value an earlier statement of the arm left,
 *   which would not be there after the `if`;
 * - no branch in either arm names the `if`'s own label — such a branch leaves
 *   the `if` and runs what follows it, which the tail would then be, on a
 *   path that skipped it before;
 * - the `if` has an `else` and no result, so the arm's tail is a statement,
 *   not the arm's value.
 *
 * The `if` stays where it was and the tail follows it in the same sequence,
 * so no block is added (upstream's CodeFolding wraps one and weighs whether
 * it pays; the sequence here is free). A tail that ends the function's body
 * or a block is the same case: the statements after the `if` simply come
 * next. Measured first (`brshapes.ts`, our -Oz output): the arms of 1,105
 * `if`s with `else` end in a statement of the same kind — 206 `local.set`,
 * 161 `call`, 157 `if`, 154 `memory.copy`, 154 `block`, ….
 *
 * Not built: the tails before several `br`s to one block, and `return`
 * tails at the function's end (upstream folds both).
 *
 * Reference: `WebAssembly/binaryen/src/passes/CodeFolding.cpp`
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  type IfExpr,
  labelName,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import type { Var } from '../../wabt-ts/ir/ir.ts';
import { None } from '../ir/types.ts';
import { mapExpression, walkExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Writes once what both arms of an `if` end with. */
export class CodeFoldingPass implements Pass {
  readonly name = 'CodeFolding';
  readonly description = 'Moves the statements both arms of an if end with to after the if.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, _foldSequences);
    }
  }
}

registerPass(CodeFoldingPass);

// ---------------------------------------------------------------------------
// Structural equality
// ---------------------------------------------------------------------------

const EXPRESSION_KINDS = new Set<unknown>(Object.values(ExpressionKind));
const isExpr = (v: unknown): v is Expression =>
  v !== null && typeof v === 'object' && EXPRESSION_KINDS.has((v as { kind?: unknown }).kind);

const DECLARES_LABEL = new Set<string>([
  ExpressionKind.Block,
  ExpressionKind.Loop,
  ExpressionKind.If,
  ExpressionKind.Try,
  ExpressionKind.TryTable,
]);

/**
 * A node and its whole subtree as one string: its own fields, then each
 * operand's key, in order. Labels are compared by POSITION, not by name: the
 * reader names every block and `if` it reads (`$block3`, `$if7`), so two
 * arms' identical nested `if`s differ in nothing but those names. A label
 * declared inside the keyed subtree is written as its declaration ordinal,
 * and a branch to it as that ordinal; a branch to a label outside is written
 * by name — the same name from either arm.
 */
export function deepKey(e: Expression, labels: string[] = []): string {
  const own: Record<string, unknown> = {};
  const parts: string[] = [];
  const inner = DECLARES_LABEL.has(e.kind) && (e as { label: string }).label !== ''
    ? [...labels, (e as { label: string }).label]
    : labels;
  const ordinal = (name: string): string => {
    const i = inner.lastIndexOf(name);
    return i < 0 ? `name:${name}` : `#${i}`;
  };
  for (const [k, v] of Object.entries(e)) {
    if (k === 'loc' || k === 'nodeId') continue;
    if (k === 'label' && DECLARES_LABEL.has(e.kind)) {
      own[k] = v === '' ? '' : `#${inner.length - 1}`;
      continue;
    }
    if ((k === 'target' || k === 'defaultTarget' || k === 'delegate') && isVar(v)) {
      own[k] = ordinal(labelName(v));
      continue;
    }
    if (k === 'targets' && Array.isArray(v) && v.every(isVar)) {
      own[k] = v.map((t) => ordinal(labelName(t)));
      continue;
    }
    if (k === 'catches' && Array.isArray(v)) {
      own[k] = v.map((c) =>
        JSON.stringify({ ...c, target: isVar(c.target) ? ordinal(labelName(c.target)) : c.target })
      );
      continue;
    }
    if (isExpr(v)) parts.push(`${k}=${deepKey(v, inner)}`);
    else if (Array.isArray(v) && v.some(isExpr)) {
      parts.push(
        `${k}=[${v.map((x) => (isExpr(x) ? deepKey(x, inner) : JSON.stringify(x))).join(',')}]`,
      );
    } else if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v) && !Array.isArray(v)) {
      // A nested record holding expressions (block params).
      parts.push(`${k}=${deepKey(v as Expression, inner)}`);
    } else own[k] = v;
  }
  const head = JSON.stringify(own, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  return `${head}{${parts.join(';')}}`;
}

const isVar = (v: unknown): v is Var =>
  v !== null && typeof v === 'object' && 'kind' in v &&
  ((v as { kind: unknown }).kind === 'index' || (v as { kind: unknown }).kind === 'name');

// ---------------------------------------------------------------------------
// What may leave an arm
// ---------------------------------------------------------------------------

/** The labels `e` declares (blocks, loops, ifs, trys) and the labels it branches to. */
function labelsOf(e: Expression): { declared: Set<string>; targets: Set<string>; pops: boolean } {
  const declared = new Set<string>(), targets = new Set<string>();
  let pops = false;
  walkExpression(e, (x) => {
    switch (x.kind) {
      case ExpressionKind.Pop:
        pops = true;
        break;
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.If:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        if (x.label !== '') declared.add(x.label);
        break;
      case ExpressionKind.Break:
        targets.add(labelName(x.target));
        break;
      case ExpressionKind.Switch:
        for (const t of x.targets) targets.add(labelName(t));
        targets.add(labelName(x.defaultTarget));
        break;
      case ExpressionKind.BrOn:
        targets.add(labelName(x.target));
        break;
      case ExpressionKind.Rethrow:
        targets.add(labelName(x.target));
        break;
      default:
        break;
    }
    if (x.kind === ExpressionKind.TryTable) {
      for (const c of x.catches) targets.add(labelName(c.target));
    }
    if (x.kind === ExpressionKind.Try && x.delegate !== undefined) {
      targets.add(labelName(x.delegate));
    }
  });
  return { declared, targets, pops };
}

/**
 * Whether a statement can move out of an arm to after the `if`: not when it
 * holds a `pop`, a value an earlier statement of the arm left on the stack,
 * which is not there after the `if`. Its branches need no check: a label is
 * in scope only inside its own construct, so a statement can name only the
 * labels it declares itself (they move with it) or those of constructs
 * enclosing the `if` (still in scope after it) — the `if`'s own label is the
 * one exception, handled for the whole arm in {@link commonTail}.
 */
function canLeave(item: Expression): boolean {
  return !labelsOf(item).pops;
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** The statements both arms end with that can leave, longest first in order; `[]` when none. */
function commonTail(iff: IfExpr): Expression[] {
  const a = iff.ifTrue, b = iff.ifFalse;
  if (b === null || iff.type !== None) return [];
  // 🔧 A branch to the `if`'s OWN label anywhere in an arm leaves the `if` and
  // runs what follows it — which the moved tail would then be, on a path that
  // skipped it before (`(br_if $i …)` ahead of the tail: found by the test,
  // where the fold changed a global). Not folded then.
  if (iff.label !== '' && [a, b].some((arm) => labelsOf(arm).targets.has(iff.label))) return [];
  const tail: Expression[] = [];
  for (let k = 1; k <= Math.min(a.children.length, b.children.length); k++) {
    const x = a.children[a.children.length - k]!, y = b.children[b.children.length - k]!;
    if (x.type !== None || deepKey(x) !== deepKey(y)) break;
    if (!canLeave(x) || !canLeave(y)) break;
    tail.unshift(x);
  }
  return tail;
}

/** A sequence with every foldable `if` followed by its arms' common tail. */
function _foldSequences(e: Expression): Expression {
  if (e.kind !== ExpressionKind.Region && e.kind !== ExpressionKind.Block) return e;
  let changed = false;
  const out: Expression[] = [];
  for (const child of e.children) {
    if (child.kind !== ExpressionKind.If) {
      out.push(child);
      continue;
    }
    const tail = commonTail(child);
    if (tail.length === 0) {
      out.push(child);
      continue;
    }
    changed = true;
    const cut = (r: RegionExpr): RegionExpr => ({
      ...r,
      children: r.children.slice(0, r.children.length - tail.length),
    });
    out.push({ ...child, ifTrue: cut(child.ifTrue), ifFalse: cut(child.ifFalse!) }, ...tail);
  }
  return changed ? { ...e, children: out } : e;
}
