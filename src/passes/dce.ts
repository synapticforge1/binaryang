/**
 * @module passes/dce
 *
 * Dead Code Elimination (DCE) pass.
 *
 * Removes expressions that provably cannot be reached at runtime.
 * Specifically, any expression that follows an `unreachable`, `return`,
 * `throw`, `throw_ref`, or `rethrow` within a block is dead and can be
 * dropped. The pass recurses into the bodies of `if`, `loop`, `try`, and
 * `try_table` so dead code buried in nested control flow is reached too.
 *
 * A structured node can end control too: a block, `if` or `try` that no
 * branch targets and whose every path ends in a terminator, or a loop whose
 * body never reaches its `end`. What follows one is dead as well, but its
 * `end` is a join point, so the stack after it is NOT polymorphic: the dead
 * tail becomes one `unreachable`, which keeps the list valid whatever its
 * own `end` expects (upstream decides by the unreachable TYPE, and its
 * writer adds the same `unreachable`; open-work 31).
 *
 * This mirrors the `DeadCodeElimination` pass in `WebAssembly/binaryen/src/passes/DeadCodeElimination.cpp`
 * in the upstream Binaryen C++ library (the simplified post-order tail-trim
 * variant — full liveness-based DCE is deferred).
 *
 * @license MIT
 */

import {
  type BlockExpr,
  type Expression,
  ExpressionKind,
  makeUnreachable,
  neverFallsThrough,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { branchTargets, mapChildrenShallow } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/**
 * Dead Code Elimination pass.
 *
 * After a child expression has type `unreachable`, any sibling expressions
 * later in the same block are unreachable and may be removed. `throw`,
 * `throw_ref`, and `rethrow` are typed `unreachable` so they trim the block
 * tail the same way `unreachable` and `return` do.
 */
export class DCEPass implements Pass {
  readonly name = 'DCE';
  readonly description =
    'Removes dead code — expressions that follow unreachable instructions in a block.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      // The targets before trimming: a dead branch still names its label, which only keeps a
      // tail until the next DCE (each function-pass round starts with one). Collecting again
      // until nothing changes was measured: six modules -Oz +19 bytes, corpus 0 (open-work 31).
      fn.body = eliminateDeadList(fn.body, branchTargets(fn.body));
    }
  }
}

registerPass(DCEPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function eliminateDeadCode(expr: Expression, targets: Set<string>): Expression {
  switch (expr.kind) {
    // ⚠️ Region and Block are the same operation on the same field. Region MUST
    // be listed: every loop / if / try / function body is one, and before
    // regions were a kind those bodies were unnamed Blocks and got trimmed here.
    // With only `Block` listed, `default` below returned them untouched — DCE
    // would have quietly stopped working on every region, and nothing typed
    // would have said so.
    case ExpressionKind.Block:
    case ExpressionKind.Region:
      return eliminateDeadList(expr, targets);

    case ExpressionKind.If:
      return {
        ...expr,
        condition: eliminateDeadCode(expr.condition, targets),
        ifTrue: eliminateDeadList(expr.ifTrue, targets),
        ifFalse: expr.ifFalse ? eliminateDeadList(expr.ifFalse, targets) : null,
      };

    case ExpressionKind.Loop:
      return { ...expr, body: eliminateDeadList(expr.body, targets) };

    case ExpressionKind.Try:
      return {
        ...expr,
        body: eliminateDeadList(expr.body, targets),
        catches: expr.catches.map((c) => ({ ...c, body: eliminateDeadList(c.body, targets) })),
      };

    case ExpressionKind.TryTable:
      return { ...expr, body: eliminateDeadList(expr.body, targets) };

    default: {
      // A block can be an OPERAND — `(local.tee (block …))`, as stack code read back often is —
      // and its dead code is as dead there (open-work 31: zig-debug's had stayed). Rebuilt only
      // when a child changed.
      let changed = false;
      const rebuilt = mapChildrenShallow(expr, (c) => {
        const d = eliminateDeadCode(c, targets);
        if (d !== c) changed = true;
        return d;
      });
      return changed ? rebuilt : expr;
    }
  }
}

/**
 * Whether control never leaves `e` forward through its own `end`: a structured node no branch
 * targets (`targets`) whose every path ends in a terminator — the loop's back edge is not a way
 * out. Only the kinds {@link neverFallsThrough} names make the stack after them polymorphic, so a
 * tail after one of these is replaced, not only cut.
 */
function endsUnreached(e: Expression, targets: Set<string>): boolean {
  const targeted = (label: string) => label !== '' && targets.has(label);
  switch (e.kind) {
    case ExpressionKind.Block:
      return !targeted(e.label) && listEndsUnreached(e.children, targets);
    case ExpressionKind.Region:
      return listEndsUnreached(e.children, targets);
    case ExpressionKind.Loop:
      return listEndsUnreached(e.body.children, targets);
    case ExpressionKind.If:
      return terminates(e.condition, targets) ||
        (e.ifFalse !== null && !targeted(e.label) &&
          listEndsUnreached(e.ifTrue.children, targets) &&
          listEndsUnreached(e.ifFalse.children, targets));
    case ExpressionKind.Try:
      // A delegating `try` has no handler of its own: its body is the only way to its `end`.
      return !targeted(e.label) && listEndsUnreached(e.body.children, targets) &&
        (e.delegate !== undefined ||
          e.catches.every((c) => listEndsUnreached(c.body.children, targets)));
    case ExpressionKind.TryTable:
      // A catch goes to its own destination, which `targets` holds when it is this label.
      return !targeted(e.label) && listEndsUnreached(e.body.children, targets);
    default:
      return false;
  }
}

const terminates = (e: Expression, targets: Set<string>): boolean =>
  neverFallsThrough(e) || endsUnreached(e, targets);

const listEndsUnreached = (children: readonly Expression[], targets: Set<string>): boolean =>
  children.some((c) => terminates(c, targets));

function eliminateDeadList<T extends BlockExpr | RegionExpr>(block: T, targets: Set<string>): T {
  const newChildren: Expression[] = [];
  let trimmed = false;
  for (let i = 0; i < block.children.length; i++) {
    // Recurse before deciding the tail — a child may contain inner dead code
    // (e.g. unreachable buried in a Try body) without itself being typed
    // unreachable, but we still want to clean inside it.
    const processed = eliminateDeadCode(block.children[i]!, targets); // bounded by the loop header
    newChildren.push(processed);
    if (i === block.children.length - 1) break;
    // 🔧 This asked whether the child's TYPE is unreachable. A node with an
    // unreachable OPERAND is typed unreachable and still pushes its value in
    // the bytes, so the tail it trimmed was carrying that value to the
    // enclosing `end`: `(select (unreachable) …)` in the spec's
    // `unreached-valid.0` left "1 element for fallthru" where 0 were expected
    // — invalid output from `wasm-opt` (see `neverFallsThrough`).
    if (neverFallsThrough(processed)) {
      trimmed = true;
      // Everything after this point is dead — stop collecting.
      break;
    }
    if (endsUnreached(processed, targets)) {
      // The tail is dead, but the stack after a structured node is not polymorphic: one
      // terminator stands for the tail. When the tail already starts with one, it is kept.
      const next = block.children[i + 1]!;
      if (neverFallsThrough(next)) {
        newChildren.push(eliminateDeadCode(next, targets));
        trimmed = i + 2 < block.children.length;
      } else {
        newChildren.push(makeUnreachable());
        trimmed = true;
      }
      break;
    }
  }
  // Reference-equality short-circuit: only rebuild when something changed.
  if (
    !trimmed &&
    newChildren.length === block.children.length &&
    newChildren.every((c, i) => c === block.children[i])
  ) {
    return block;
  }
  return { ...block, children: newChildren };
}
