// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/spill-stack-values
 *
 * Makes the value a `pop` stands for EXPLICIT wherever a pass could lose it —
 * One front end, stage 2, inventory row R11'.
 *
 * The wabt-ts reader is byte-faithful, so where the binary leaves a value on the
 * operand stack and a later INSTRUCTION takes it, the reader keeps the producer
 * where it was and gives the consumer a `pop`. What connects the two is the wasm
 * stack itself: nothing in the tree says which node the `pop` will find. That is
 * right for fidelity and wrong for optimization — a pass only has to put a BLOCK
 * BOUNDARY between them and the value is out of reach:
 *
 *     local.get 0          ⟶  local.get 0
 *     return (pop)             (block (local.set 3 (pop)) …)   ← invalid
 *
 * which is what `Inlining` did at -O3 to `spec/nop/nop.0.wasm` and
 * `spec/br/br.0.wasm`: "not enough arguments on the stack for local.set". A block
 * body cannot consume the enclosing frame's stack.
 *
 * binaryen-ts's decoder (deleted at 1.6.0) never had the problem because it
 * spilled while decoding (`wasm-parser.ts`'s `pop`): the value goes into a fresh local AT ITS ORIGINAL
 * POSITION and the consumer reads that local. This does the same to a finished
 * tree, so route B reaches the passes in the shape they were written for, while
 * the reader's own output stays byte-exact — a `pop` writes nothing, and this runs
 * only when a pass is going to run.
 *
 * **Which values.** Only those a pass can separate: a value produced by one
 * region-level INSTRUCTION and consumed by a later one. Everything else is left
 * exactly as it is, because binaryen-ts's decoder leaves it too and the two routes
 * must agree:
 *
 * - a value produced by a SIBLING OPERAND of the same node — `i32.sub(pop, call)`,
 *   where the call's first result is the `pop` — stays. The two live in one node;
 *   there is nothing between them to move.
 * - an ENTRY value (a carrier's parameter, a `catch` handler's payload, R13 / R14)
 *   stays a `pop`: no instruction produced it. `lowerBlockParams` is what turns a
 *   carrier's into locals.
 * - a MULTI-result producer stays: its values are spread across the tree (the node
 *   for its last, sibling `pop`s for the earlier ones), so no one node is "the
 *   value" to spill and one local cannot hold a tuple. The decoder's own rule is
 *   the same — "a `Pop` must be consumed in place, never spilled".
 * - a value that stands UNDER a `br_on_*` on its way to its consumer stays. A
 *   `br_on` carries the stack beneath its operands to its label when it branches
 *   and LEAVES it there when it falls through; the reader keeps those values as
 *   preceding statements (`values` empty) because the fall-through consumes them
 *   later. Spilled, the branch finds only its own operands: `(block (result i32
 *   i32 eqref) i32.const 1 i32.const 2 (call $f (br_on_cast_desc_eq 0 …)) …)`
 *   came out "expected 3 elements on the stack for branch, found 1" at every
 *   optimization level (`proposals/custom-descriptors`, 2026-09-29, the first
 *   run of the proposals behaviour gate).
 *
 * **Which rewrite.** `local.set $t` where the producer stood and `local.get $t` at
 * the `pop` — except when the consumer is the very NEXT instruction, where the
 * producer simply moves into the `pop`'s place, as the decoder does when the value
 * is still on top of its list. A `pop` that finds NOTHING (stack-polymorphic code)
 * becomes `unreachable`: that is the phantom value wasm gives it, and unlike a
 * `pop` it is self-contained.
 *
 * ⚠️ Which node a `pop` will find is not something to re-derive here: it takes
 * every arity rule in the language (a `br_if`'s target, a multi-value call, a
 * polymorphic stack). `deriveTypes` already simulates exactly that to type the
 * `pop`s, so it records the origins on request (`PopSources`) and this step only
 * decides what to do with them. A second copy of the simulation is what the first
 * attempt at this file was, and it mistook `i32.sub(pop, call)` for a `pop` with
 * nothing behind it — 10 multi-value tests, and the trees it produced TRAPPED.
 */

import {
  type Expression,
  ExpressionKind,
  type IfExpr,
  makeLocalGet,
  makeLocalSet,
  makeUnreachable,
  type RegionExpr,
  typeOf,
} from '../ir/expressions.ts';
import { deriveTypes, type PopSources, slots } from '../ir/derive-types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { mapExpression, visitChildren, walkExpression } from '../ir/walk.ts';
import { collapsePhantomConsumers } from '../ir/phantoms.ts';
import { varIndex } from '../../wabt-ts/ir/ir.ts';

/** Every sequence of instructions in `e`'s subtree, each with its own stack. */
function regionsIn(e: Expression): { children: readonly Expression[] }[] {
  const out: { children: readonly Expression[] }[] = [];
  const add = (holder: { children: readonly Expression[] }): void => {
    out.push(holder);
    for (const c of holder.children) walk(c);
  };
  const walk = (n: Expression): void => {
    switch (n.kind) {
      case ExpressionKind.Region: // a function body, or one reached on its own
        add(n as RegionExpr);
        return;
      case ExpressionKind.Block:
        add(n);
        return;
      case ExpressionKind.Loop:
      case ExpressionKind.TryTable:
        add(n.body);
        return;
      case ExpressionKind.If: {
        add((n as IfExpr).ifTrue);
        if ((n as IfExpr).ifFalse !== null) add((n as IfExpr).ifFalse!);
        break; // the condition and the parameters belong to the enclosing stack
      }
      case ExpressionKind.Try:
        add(n.body);
        for (const c of n.catches) add(c.body);
        break;
      default:
        break;
    }
    // Operands can hold carriers of their own: `(i32.add (block …) …)`.
    for (const c of operandsIn(n)) walk(c);
  };
  walk(e);
  return out;
}

/** `e`'s operands — its children other than the instruction sequences it owns. */
function operandsIn(e: Expression): Expression[] {
  const out: Expression[] = [];
  if ('params' in e && e.params) out.push(...e.params.values);
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.TryTable:
    case ExpressionKind.Try:
      return out;
    case ExpressionKind.If:
      out.push((e as IfExpr).condition);
      return out;
    default: {
      // Everything else holds only operands. DIRECT children only: the callers
      // walk themselves, and `mapExpression` here (which recurses the whole
      // subtree) made the walk re-enter every descendant until the stack blew.
      visitChildren(e, (c) => {
        if (c.kind === ExpressionKind.Region) {
          // A construct with instructions of its own that the switch above does
          // not list — a new kind. Refuse rather than treat them as operands.
          throw new Error(
            `spill-stack-values: ${String(e.kind)} holds a region it did not declare`,
          );
        }
        out.push(c);
      });
      return out;
    }
  }
}

/** How many values `e` leaves on the stack. */
function producedCount(e: Expression): number {
  return slots(typeOf(e)).length;
}

/**
 * Makes every stack-held value explicit in `module`, in place. Returns how many
 * functions were rewritten.
 */
export function spillStackValues(module: WasmModule): number {
  // Nothing to make explicit unless the tree HOLDS a `pop`. Worth checking first
  // rather than deriving types to find out: a module built by hand or by a pass
  // has none, and asking `deriveTypes` about one costs a full walk — and can
  // fail, since a hand-built module may name a function it does not contain
  // (6 tests did exactly that when this ran unconditionally).
  if (!module.functions.some((f) => holdsPop(f.body as unknown as Expression))) return 0;
  const sources: PopSources = new Map();
  try {
    deriveTypes(module, sources);
  } catch {
    // The stack cannot be simulated, so which value each `pop` takes is unknown
    // and there is nothing safe to rewrite. Route B's trees always come through
    // `prepareForPasses`, which derives types already, so this is a tree from
    // somewhere else — left exactly as it was, which is what it got before.
    return 0;
  }
  let count = 0;
  for (const f of module.functions) {
    if (rewriteFunction(f, sources)) count++;
  }
  return count;
}

function rewriteFunction(f: WasmFunction, sources: PopSources): boolean {
  let changed = false;
  // First, a phantom that a LATER operand's transfer makes dead must not become
  // an `unreachable` that runs before it — `br 0; i32.add` trapped instead of
  // branching (`spec/br/br.0.wasm`). Such a consumer never runs; it is taken
  // apart (`ir/phantoms.ts`). What is left is phantoms in code already dead.
  // RECORDED with nothing behind it: a bare `pop` statement is never taken as an
  // operand, so it is not in `sources` at all — and it is not a phantom.
  const phantom = (e: Expression) =>
    e.kind === ExpressionKind.Pop && sources.has(e) && sources.get(e) === undefined;
  let holdsPhantom = false;
  walkExpression(f.body as unknown as Expression, (e) => {
    if (phantom(e)) holdsPhantom = true;
  });
  if (holdsPhantom) {
    (f as { body: RegionExpr }).body = collapsePhantomConsumers(f.body as RegionExpr, phantom);
  }
  for (const region of regionsIn(f.body as unknown as Expression)) {
    if (rewriteRegion(region, f, sources)) changed = true;
  }
  return changed;
}

/** One sequence: spill what a pass could separate, leave the rest. */
function rewriteRegion(
  holder: { children: readonly Expression[] },
  f: WasmFunction,
  sources: PopSources,
): boolean {
  const children = holder.children;
  const indexOf = new Map<Expression, number>();
  children.forEach((c, i) => indexOf.set(c, i));

  /** Every `pop` in child `j`'s own operands (not in a sequence it owns). */
  const popsIn = (e: Expression): Expression[] => {
    const found: Expression[] = [];
    const walk = (n: Expression): void => {
      if (n.kind === ExpressionKind.Pop) {
        found.push(n);
        return;
      }
      for (const c of operandsIn(n)) walk(c);
    };
    for (const c of operandsIn(e)) walk(c);
    return found;
  };

  /** Whether `e`'s own operands (not a sequence it owns) hold a `br_on_*`. */
  const holdsBrOn = (e: Expression): boolean => {
    if (e.kind === ExpressionKind.BrOn) return true;
    return operandsIn(e).some(holdsBrOn);
  };
  const brOnAt = children.map(holdsBrOn);
  /** A `br_on` runs after producer `i` and no later than consumer `j`: it reads `i`'s value. */
  const underBrOn = (i: number, j: number): boolean => brOnAt.slice(i + 1, j + 1).includes(true);

  const replacement = new Map<Expression, Expression>();
  const spilled = new Map<number, number>(); // producer index -> local slot
  const nested = new Set<number>(); // producer indices moved into their consumer
  for (const [j, child] of children.entries()) {
    for (const pop of popsIn(child)) {
      const from = sources.get(pop);
      if (from === undefined) {
        // Nothing behind it: stack-polymorphic code, where the phantom value is
        // of the bottom type. `unreachable` IS that value.
        replacement.set(pop, makeUnreachable());
        continue;
      }
      if (from === 'entry') continue; // a parameter or a caught payload
      const i = indexOf.get(from);
      if (i === undefined || i >= j) continue; // a sibling operand, not a statement
      if (producedCount(from) !== 1) continue; // a tuple: no one node to spill
      if (underBrOn(i, j)) continue; // a `br_on` carries it too: it must stay on the stack
      if (i === j - 1 && !nested.has(i) && !spilled.has(i)) {
        nested.add(i);
        replacement.set(pop, from);
        continue;
      }
      let local = spilled.get(i);
      if (local === undefined) {
        local = f.locals.length; // params come first in the one index space
        f.locals.push({ type: typeOf(from) as ValueType });
        spilled.set(i, local);
      }
      replacement.set(pop, makeLocalGet(varIndex(local), typeOf(from) as ValueType));
    }
  }
  if (replacement.size === 0) return false;

  // A producer moved into its consumer is rewritten TOO: it may be the consumer
  // of the statement before it. 🔧 It was inserted as it stood, so in a chain —
  // `block`, `array.get (pop)`, `return (pop)` — the `return` got the ORIGINAL
  // `array.get`, whose `pop` still waited for a `block` that was no longer
  // anywhere: the block was deleted and the module invalid, or, where the types
  // allowed it, silently wrong. Found by the block-parameter lowering (R15),
  // which leaves such chains wherever it splits a statement.
  const resolve = (n: Expression): Expression => {
    const r = replacement.get(n);
    return r === undefined ? n : mapExpression(r, resolve);
  };
  const rebuilt: Expression[] = [];
  for (const [j, child] of children.entries()) {
    if (nested.has(j)) continue; // moved into its consumer
    const local = spilled.get(j);
    const held = local === undefined ? child : makeLocalSet(varIndex(local), child);
    rebuilt.push(mapExpression(held, resolve));
  }
  (holder as { children: Expression[] }).children = rebuilt;
  return true;
}

/** Whether `e`'s subtree holds a `pop` at all. */
function holdsPop(e: Expression): boolean {
  let found = false;
  walkExpression(e, (n) => {
    if (n.kind === ExpressionKind.Pop) found = true;
  });
  return found;
}
