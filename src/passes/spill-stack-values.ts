// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/spill-stack-values
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
 * **Values NOTHING takes** (open-work 13, the code lens). Where an
 * `unreachable`-typed instruction made the stack polymorphic, the values still on
 * it are discarded — valid wasm, kept by the reader as written. Left so, a pass
 * that wraps the code after them in a block leaves them on a stack that is no
 * longer polymorphic, and the module is invalid (`Inlining` did it). So:
 *
 * - such a value standing as a STATEMENT is dropped where it stands, as
 *   binaryen's reader reads it;
 * - one the reader made an OPERAND — `(i64.add (i32.shl …) (… (unreachable)))`,
 *   where the add really takes the bottom value — means its consumer never
 *   runs: the consumer is taken apart into its operands, evaluated in order,
 *   then `unreachable`.
 *
 * Which values those are is the derivation's to say ({@link Discarded}), like
 * the `pop` origins.
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
  makeDrop,
  makeLocalGet,
  makeLocalSet,
  makeUnreachable,
  type RegionExpr,
  typeOf,
} from '../ir/expressions.ts';
import { deriveTypes, type Discarded, type PopSources, slots } from '../ir/derive-types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { Unreachable } from '../ir/types.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { mapExpression, mapWithSequences, visitChildren, walkExpression } from '../ir/walk.ts';
import { collapsePhantomConsumers, evaluated, operandsInOrder } from '../ir/phantoms.ts';
import { varIndex } from '../ir/ir.ts';

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
  // Nothing to make explicit unless the tree HOLDS a `pop`, or a value left on
  // the stack. Worth checking first
  // rather than deriving types to find out: a module built by hand or by a pass
  // has none, and asking `deriveTypes` about one costs a full walk — and can
  // fail, since a hand-built module may name a function it does not contain
  // (6 tests did exactly that when this ran unconditionally).
  if (!module.functions.some((f) => holdsStackValue(f.body as unknown as Expression))) return 0;
  const sources: PopSources = new Map();
  const discarded: Discarded = new Set();
  try {
    deriveTypes(module, sources, discarded);
  } catch {
    // The stack cannot be simulated, so which value each `pop` takes is unknown
    // and there is nothing safe to rewrite. Route B's trees always come through
    // `prepareForPasses`, which derives types already, so this is a tree from
    // somewhere else — left exactly as it was, which is what it got before.
    return 0;
  }
  const changed = new Set<WasmFunction>();
  for (const f of module.functions) {
    if (collapseDeadConsumers(f, sources, discarded)) changed.add(f);
  }
  if (changed.size > 0) {
    // 🔧 The collapse REBUILDS every node above what it replaced (`mapWithSequences`
    // copies a node whose children it mapped), and `sources` / `discarded` name
    // nodes by identity — a producer with operands of its own was no longer found,
    // so the spill below silently skipped it. The simulation is run again on the
    // tree as it now is (open-work 13, the code lens).
    sources.clear();
    discarded.clear();
    try {
      deriveTypes(module, sources, discarded);
    } catch {
      return changed.size; // as above: nothing more is safe to rewrite
    }
  }
  for (const f of module.functions) {
    let rewrote = false;
    for (const region of regionsIn(f.body as unknown as Expression)) {
      if (rewriteRegion(region, f, sources, discarded)) rewrote = true;
    }
    if (rewrote) changed.add(f);
  }
  return changed.size;
}

/** Marks a consumer {@link collapseDeadConsumers} takes apart; a copy keeps it (spread copies symbol keys). */
const TAKES_DISCARDED = Symbol('takes a discarded operand');

/**
 * Takes apart, in `f`, every consumer that never runs because the stack went
 * polymorphic while its operands were being evaluated. Returns whether anything
 * changed — the caller then derives the stack again, since this rebuilds nodes.
 */
function collapseDeadConsumers(
  f: WasmFunction,
  sources: PopSources,
  discarded: Discarded,
): boolean {
  let changed = false;
  // A consumer one of whose OPERANDS nothing takes: the reader gave it a
  // value the stack no longer held when it ran — `i32.shl …; unreachable;
  // i32.load; i64.extend_i32_u; i64.add` reads as `(i64.add (i32.shl …)
  // (i64.extend_i32_u (i32.load (unreachable))))`, byte-faithful and ill-typed,
  // since the `i64.add` takes the bottom value, not the `i32.shl`. A later operand
  // never returned, so the consumer never runs: it is taken apart into its
  // operands, evaluated in order, then `unreachable`. Left whole, it looked like
  // a live `i64.add` of an i32, and `OptimizeInstructions` rewrote it into
  // reachable, invalid code (open-work 13, the code lens: a valid mutant of a
  // wasmtk producer binary). Its `pop`s are all phantoms — the stack was
  // polymorphic before it took them — and go.
  //
  // Both collapses rebuild nodes, and `discarded` names nodes by identity, so
  // such a consumer is MARKED first, while the tree is the one the set describes
  // (`walkExpression` visits nodes in place); the mark rides on the copies the
  // maps make. Every marked node is replaced, so none reaches the output.
  let holdsDiscarded = false;
  walkExpression(f.body as unknown as Expression, (e) => {
    if (operandsInOrder(e).some((o) => discarded.has(o))) {
      (e as unknown as Record<symbol, true>)[TAKES_DISCARDED] = true;
      holdsDiscarded = true;
    }
  });
  // A phantom that a LATER operand's transfer makes dead must not become an
  // `unreachable` that runs before it — `br 0; i32.add` trapped instead of
  // branching (`spec/br/br.0.wasm`). Such a consumer never runs; it is taken
  // apart (`ir/phantoms.ts`). What is left is phantoms in code already dead.
  // RECORDED with nothing behind it: a bare `pop` statement is never taken as an
  // operand, so it is not in `sources` at all — and it is not a phantom. (A
  // `pop` has no operands, so a copy is never made of one: `sources` still
  // names every `pop` here.)
  const phantom = (e: Expression) =>
    e.kind === ExpressionKind.Pop && sources.has(e) && sources.get(e) === undefined;
  let holdsPhantom = false;
  walkExpression(f.body as unknown as Expression, (e) => {
    if (phantom(e)) holdsPhantom = true;
  });
  if (holdsPhantom) {
    changed = true;
    (f as { body: RegionExpr }).body = collapsePhantomConsumers(f.body as RegionExpr, phantom);
  }
  if (holdsDiscarded) {
    changed = true;
    (f as { body: RegionExpr }).body = mapWithSequences(f.body as RegionExpr, (n) => {
      if (!(TAKES_DISCARDED in n)) return n;
      const ops = operandsInOrder(n).filter((o) => o.kind !== ExpressionKind.Pop);
      return { sequence: [...ops.map(evaluated), makeUnreachable()] };
    });
  }
  return changed;
}

/** One sequence: spill what a pass could separate, drop what nothing takes, leave the rest. */
function rewriteRegion(
  holder: { children: readonly Expression[] },
  f: WasmFunction,
  sources: PopSources,
  discarded: Discarded,
): boolean {
  const children = holder.children;
  const indexOf = new Map<Expression, number>();
  children.forEach((c, i) => indexOf.set(c, i));
  /** The statement whose operands hold a node (not an owned sequence's): where a nested producer's extra values come from. */
  const statementOf = new Map<Expression, number>();
  children.forEach((c, i) => {
    const walk = (n: Expression): void => {
      statementOf.set(n, i);
      for (const o of operandsIn(n)) walk(o);
    };
    walk(c);
  });

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
    const pops = popsIn(child);
    /**
     * Whether `pop` must stay a `pop` — its value stays on the stack: an entry
     * value, a tuple's value, one a `br_on` carries. A phantom is not one (it
     * becomes `unreachable`, which pushes nothing and ends the stack).
     */
    const stays = (pop: Expression): boolean => {
      const from = sources.get(pop);
      if (from === undefined) return false;
      if (from === 'entry') return true;
      const s = statementOf.get(from);
      if (s === undefined || s >= j) return false; // a sibling operand: produced in place
      // A value an earlier statement left: a tuple's, a nested producer's
      // extra result, one a `br_on` carries — or a statement's own, which is
      // spilled below unless it, too, is kept.
      return indexOf.get(from) === undefined || producedCount(from) !== 1 || underBrOn(s, j);
    };
    // 🔧 The pops of one statement are consumed in evaluation order, the
    // deeper stack slot first. A `local.get` (or a nested producer) put in for
    // an EARLIER pop pushes its value on top of what a LATER one that stays
    // was to take, and the later one takes the wrong value — `i32.add (pop)
    // (… (local.tee (pop)) …)` over `i32.const 4; call $two_results;
    // local.set`: the first pop became `local.get`, the `local.tee` took that
    // i32 for its f64. So once any pop stays, every pop before it stays too
    // (found by E4: upstream's `wasm-ctor-eval` output, -Oz, V8 refused it).
    const lastStay = pops.reduce((last, pop, k) => (stays(pop) ? k : last), -1);
    for (const [k, pop] of pops.entries()) {
      const from = sources.get(pop);
      if (from === undefined) {
        // Nothing behind it: stack-polymorphic code, where the phantom value is
        // of the bottom type. `unreachable` IS that value.
        replacement.set(pop, makeUnreachable());
        continue;
      }
      if (k <= lastStay) continue; // it, or a pop after it, keeps the stack
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
  // A statement whose value NOTHING takes — still on the stack when a
  // polymorphic point discarded it (`local.get 0; i32.const 8; unreachable`) —
  // is dropped where it stands, as binaryen's reader reads it. Left bare, it is
  // valid only while the code after it stays polymorphic at this level, and a
  // pass that wraps that code in a block ends that: `Inlining` turned a call
  // with an `unreachable` operand into a typed block, and the `then` arm ended
  // with two values on its stack (open-work 13, the code lens; a valid mutant
  // of a wasmtk producer binary). Evaluated as before, so nothing changes at
  // run time.
  // A `br_on` is not one: it leaves its carried values AND its reference, and
  // its node type is the reference alone, so a `drop` would leave the rest.
  const dead = new Set<number>();
  children.forEach((c, j) => {
    if (
      discarded.has(c) && producedCount(c) === 1 && c.kind !== ExpressionKind.BrOn &&
      !spilled.has(j) && !nested.has(j)
    ) {
      dead.add(j);
    }
  });
  if (replacement.size === 0 && dead.size === 0) return false;

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
    const held = local !== undefined
      ? makeLocalSet(varIndex(local), child)
      : dead.has(j)
      ? makeDrop(child)
      : child;
    rebuilt.push(mapExpression(held, resolve));
  }
  (holder as { children: Expression[] }).children = rebuilt;
  return true;
}

/**
 * Whether `e`'s subtree holds a `pop`, a statement that leaves a value on its
 * sequence's stack before the end, or a node that never returns INSIDE a
 * statement's operands (where an earlier operand's value may be one nothing
 * takes) — something for this step to make explicit.
 */
function holdsStackValue(e: Expression): boolean {
  let found = false;
  walkExpression(e, (n) => {
    if (n.kind === ExpressionKind.Pop) found = true;
  });
  if (found) return true;
  const neverReturns = (n: Expression): boolean =>
    operandsIn(n).some((o) => typeOf(o) === Unreachable || neverReturns(o));
  for (const region of regionsIn(e)) {
    const c = region.children;
    for (let i = 0; i < c.length - 1; i++) if (producedCount(c[i]!) > 0) return true;
    if (c.some(neverReturns)) return true;
  }
  return false;
}
