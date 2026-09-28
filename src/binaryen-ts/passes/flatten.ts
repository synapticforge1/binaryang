/**
 * @module binaryen-ts/passes/flatten
 *
 * Flatten pass — rewrites each function into **Flat IR**, the form in which:
 *
 *  - every side-effecting or value-producing subexpression is hoisted into its
 *    own `local.set $tmp (...)` statement, and used via `local.get $tmp`;
 *  - operands are therefore always *trivial* (a `local.get` or a constant);
 *  - control-flow structures (`block` / `if` / `loop` / `try`) are statements
 *    whose value, if any, flows out through temp locals; their conditions are
 *    trivial.
 *
 * This mirrors upstream Binaryen's `WebAssembly/binaryen/src/passes/Flatten.cpp`. It is a
 * prerequisite for the Asyncify flow transform (`asyncify.ts` Stage 3), which
 * relies on calls being standalone statements and on control-flow conditions
 * being trivial so it can wrap each call and "skip forward" while rewinding.
 *
 * ## Formulation
 *
 * Upstream uses an in-place `ExpressionStackWalker` with a pointer-identity
 * "preludes" map. This port uses the equivalent, and cleaner-in-TS, recursive
 * formulation: `flattenExpr(e)` returns `{ pre, value }` where `pre` is the list
 * of statements to run before `e`'s value is available and `value` is a trivial
 * expression (or `nop` for a void `e`). Preludes bubble up to the nearest
 * enclosing statement position exactly as they do upstream.
 *
 * ## Multi-value, and the operand stack (2026-09-28)
 *
 * Upstream holds a multi-value result in a TUPLE local. This IR has no tuple
 * kind (V1, S6 6A), so an N-value result lives in N ordinary temps: `values`
 * beside `value` in {@link Flat}. A producer's values are captured off the
 * real stack as wasm leaves them — `(call $pair) (local.set $t1) (local.set
 * $t0)`, each `local.set` taking a `pop` ("already on the stack").
 *
 * The reader keeps stack form where a tree cannot say it: a multi-value
 * producer's EARLIER values are `pop`s just before it in its consumer's operand
 * list; a value a statement leaves may be taken by a later instruction (a
 * value-less `br` to a value-taking block, a trailing `nop` after a block's
 * value). So each stack FRAME — a block, an arm, a loop or `try` body, a catch,
 * the function — keeps a model of the operand stack: the values its statements
 * left and nothing has taken yet, each already in a fresh temp or a constant
 * ({@link Ctx.stack}). A `pop` takes from it, a value-less branch to a
 * value-taking target takes from it, and a frame's result is what sits on top
 * at its end. After an instruction typed `unreachable` the stack is
 * polymorphic: what was on it is abandoned, and a `pop` with nothing under it
 * reads `unreachable`.
 *
 * ## Not supported, as upstream
 *
 * `try_table` and `br_on_*` are refused by name — upstream refuses both too
 * (`--flatten` crashes on `try_table`, "Unsupported instruction for Flatten:
 * BrOn"). A block, loop, `if` or `try` with PARAMETERS is refused: the runner
 * lowers them before any pass runs, so one here was built by hand.
 *
 * @license MIT
 */

import {
  type BlockExpr,
  type BreakExpr,
  type CallExpr,
  type CallIndirectExpr,
  type Catch,
  type Expression,
  ExpressionKind,
  type IfExpr,
  type LoopExpr,
  makeBlock,
  makeBreak,
  makeIf,
  makeLocalGet,
  makeLocalSet,
  makeLoop,
  makeNop,
  makePop,
  makeRegion,
  makeReturn,
  makeSwitch,
  makeUnreachable,
  type RegionExpr,
  type SwitchExpr,
  type TryExpr,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { None, type Type, Unreachable, type ValType } from '../ir/types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { mapChildrenShallow } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { requireName, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** The value types a type stands for: none for `none` / `unreachable`, N for a tuple. */
function valTypes(t: Type): ValType[] {
  if (t === None || t === Unreachable || t === undefined) return [];
  return Array.isArray(t) ? (t as ValType[]) : [t as ValType];
}

/** Expressions that are trivial operands: keep them inline, no preludes. */
function isTrivial(e: Expression): boolean {
  switch (e.kind) {
    case ExpressionKind.Const:
    case ExpressionKind.RefNull:
    case ExpressionKind.RefFunc:
    case ExpressionKind.Nop:
    case ExpressionKind.Unreachable:
      return true;
    default:
      return false;
  }
}

/** Control-flow structures handled explicitly (children may have side effects). */
function isControlFlow(e: Expression): boolean {
  return e.kind === ExpressionKind.Block ||
    e.kind === ExpressionKind.Region ||
    e.kind === ExpressionKind.If ||
    e.kind === ExpressionKind.Loop ||
    e.kind === ExpressionKind.Try;
}

/** Kinds this port does not flatten — upstream refuses both too. */
function rejectUnsupported(e: Expression): void {
  switch (e.kind) {
    case ExpressionKind.TryTable:
    case ExpressionKind.BrOn:
      throw new Error(`flatten: ${e.kind} is not supported (upstream's Flatten refuses it too).`);
  }
  const params = (e as { params?: { values: unknown[] } }).params;
  if (params !== undefined && params.values.length > 0) {
    throw new Error(
      `flatten: a ${e.kind} with parameters (the runner lowers them before any pass; this one was built by hand).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Flatten context (per function)
// ---------------------------------------------------------------------------

/** The temps a construct's value — and every branch that carries one to it — fills. */
interface Temps {
  temps: number[];
  types: ValType[];
}

interface Ctx {
  func: WasmFunction;
  /**
   * Maps a direct-call target name to its result type. The WAT/binary parser
   * leaves `Call.type === none` (the callee's result is implicit in wasm), so
   * flatten must resolve it here to know whether a call produces a value that
   * needs hoisting into a local.
   */
  callResultTypes: Map<string, Type>;
  /** A tag's parameter types, by name — a legacy `catch`'s payload. */
  tagParams: Map<string, ValType[]>;
  /**
   * The temps a value-carrying branch fills, by the LABEL of the construct it
   * targets — the same temps the construct's own fall-through value is routed
   * into (upstream's `getTempForBreakTarget`). Registered when the construct is
   * entered; a label names one construct.
   */
  branchTemps: Map<string, Temps>;
  /**
   * The function's results as a branch TARGET: a `br_table` that may leave the
   * function with values branches to a block wrapped around the body instead,
   * `frame.label`, and the body's end returns these temps. Made on first use.
   */
  frame: (Temps & { label: string }) | null;
  /**
   * This frame's model of the operand stack: values its statements left that
   * nothing has taken yet, deepest first — each a fresh temp's `local.get` or a
   * constant, so reading it late reads what was computed early.
   */
  stack: Expression[];
  /** An instruction typed `unreachable` ran in this frame: the stack is polymorphic. */
  polymorphic: boolean;
}

/**
 * The effective result type of a (possibly type-`none`) call node — a tuple
 * for a multi-result call. An unresolvable direct-call target is an error, not
 * `none`: `buildCallResultTypes` registers every import and defined function, so
 * a miss means a dangling target, and typing it `none` silently discarded the
 * call's value.
 */
function callEffectiveType(e: Expression, ctx: Ctx): Type {
  if (e.kind === ExpressionKind.Call) {
    const target = requireName((e as CallExpr).func, 'call target');
    const t = ctx.callResultTypes.get(target);
    if (t === undefined) {
      throw new Error(`Flatten: unresolved call target "${target}"`);
    }
    return t;
  }
  if (e.kind === ExpressionKind.CallIndirect) {
    const r = (e as CallIndirectExpr).sig.results;
    return r.length === 0 ? None : r.length === 1 ? r[0]! : (r as Type);
  }
  return typeOf(e);
}

/** Allocate a fresh local of each type; their indices. */
function allocTemps(ctx: Ctx, types: readonly ValType[]): number[] {
  return types.map((type) => {
    const idx = ctx.func.locals.length;
    ctx.func.locals.push({ type });
    return idx;
  });
}

const getsOf = (t: Temps): Expression[] =>
  t.temps.map((i, k) => makeLocalGet(varIndex(i), t.types[k]!));
const setsOf = (t: Temps, values: readonly Expression[]): Expression[] =>
  t.temps.map((i, k) => makeLocalSet(varIndex(i), values[k]!));

/** The result of flattening one expression. */
interface Flat {
  /** Statements to run, in order, before `value` is available. */
  pre: Expression[];
  /** A trivial value expression (or `nop` when the source was void). */
  value: Expression;
  /** For an N-value result: its N trivial values, in stack order (`value` is `nop`). */
  values?: Expression[];
}

/** The trivial values a flattened expression leaves: none, one, or N. */
function valuesOf(f: Flat): Expression[] {
  if (f.values !== undefined) return f.values;
  const k = f.value.kind;
  return k === ExpressionKind.Nop || k === ExpressionKind.Unreachable ? [] : [f.value];
}

/**
 * Capture the N values a statement leaves on the REAL stack into N fresh
 * temps: the statement, then `local.set` of each, deepest last (each takes a
 * `pop`, which the writer writes as nothing).
 */
function capture(
  stmt: Expression,
  types: readonly ValType[],
  ctx: Ctx,
): { pre: Expression[]; values: Expression[] } {
  const t: Temps = { temps: allocTemps(ctx, types), types: [...types] };
  const sets: Expression[] = [];
  for (let k = types.length - 1; k >= 0; k--) {
    sets.push(makeLocalSet(varIndex(t.temps[k]!), makePop(types[k]!)));
  }
  return { pre: [stmt, ...sets], values: getsOf(t) };
}

/**
 * Take `n` values off this frame's stack, deepest first. Short of them in a
 * polymorphic stretch (dead code), what is missing reads `unreachable`; short
 * of them in live code the tree does not say where they come from — refused.
 */
function take(n: number, ctx: Ctx, what: string): Expression[] {
  if (n === 0) return [];
  if (ctx.stack.length >= n) return ctx.stack.splice(ctx.stack.length - n, n);
  if (ctx.polymorphic) {
    const have = ctx.stack.splice(0);
    return [...Array(n - have.length).fill(null).map(() => makeUnreachable()), ...have];
  }
  throw new Error(
    `Flatten: ${what} takes ${n} value(s) from the stack and ${ctx.stack.length} are there (in "${ctx.func.name}")`,
  );
}

/** Run `fn` in a fresh stack frame, seeded with `seed`; the outer frame is restored after. */
function inFrame<T>(ctx: Ctx, seed: Expression[], fn: () => T): T {
  const [stack, polymorphic] = [ctx.stack, ctx.polymorphic];
  ctx.stack = [...seed];
  ctx.polymorphic = false;
  try {
    return fn();
  } finally {
    ctx.stack = stack;
    ctx.polymorphic = polymorphic;
  }
}

// ---------------------------------------------------------------------------
// Core recursion
// ---------------------------------------------------------------------------

function flattenExpr(e: Expression, ctx: Ctx): Flat {
  rejectUnsupported(e);

  // Constants / nop / unreachable are already trivial.
  if (isTrivial(e)) return { pre: [], value: e };

  // A value already on the stack: this frame's model has it.
  if (e.kind === ExpressionKind.Pop) return { pre: [], value: take(1, ctx, 'a `pop`')[0]! };

  if (isControlFlow(e)) return flattenControlFlow(e, ctx);

  // local.tee is disallowed in Flat IR: rewrite to a set (prelude) + get.
  // The result must read a FRESH temp, not `local.get tee.index`: returning the
  // original local left the value clobberable by a later sibling operand whose
  // own prelude writes the same local (e.g. two tees to the same local as
  // sibling operands) → the parent read the wrong value. Capture into a temp
  // that nothing else writes, mirroring the general-case hoist below.
  if (e.kind === ExpressionKind.LocalTee) {
    const tee = e as { var: Var; value: Expression; type: Type };
    const inner = flattenOperands([tee.value], ctx);
    const [temp] = allocTemps(ctx, [tee.type as ValType]);
    return {
      pre: [
        ...inner.pre,
        makeLocalSet(varIndex(temp!), inner.values[0]!),
        makeLocalSet(tee.var, makeLocalGet(varIndex(temp!), tee.type as ValType)),
      ],
      value: makeLocalGet(varIndex(temp!), tee.type as ValType),
    };
  }

  // Branches that carry values — written with them, or taking them from the
  // stack: the values go into the target's temps, and the branch goes without.
  if (e.kind === ExpressionKind.Break && carriesValues(e as BreakExpr, ctx)) {
    return flattenValueBreak(e as BreakExpr, ctx);
  }
  if (e.kind === ExpressionKind.Switch && carriesValues(e as SwitchExpr, ctx)) {
    return flattenValueSwitch(e as SwitchExpr, ctx);
  }

  // General case: flatten the operands (eval order), collecting their preludes,
  // then reduce the rebuilt node according to its type.
  const ops: Expression[] = [];
  mapChildrenShallow(e, (c) => (ops.push(c), c));
  const flat = flattenOperands(ops, ctx, `the operands of a \`${e.kind}\``);
  let i = 0;
  const rebuilt = mapChildrenShallow(e, () => flat.values[i++]!);

  if (rebuilt.type === Unreachable) {
    return { pre: [...flat.pre, rebuilt], value: makeUnreachable() };
  }
  // Calls carry `type === none` from the parser; resolve their true result type.
  const types = valTypes(callEffectiveType(rebuilt, ctx));
  if (types.length === 1) {
    const [temp] = allocTemps(ctx, types);
    return {
      pre: [...flat.pre, makeLocalSet(varIndex(temp!), rebuilt)],
      value: makeLocalGet(varIndex(temp!), types[0]!),
    };
  }
  if (types.length > 1) {
    const c = capture(rebuilt, types, ctx);
    return { pre: [...flat.pre, ...c.pre], value: makeNop(), values: c.values };
  }
  // Void statement (store, local.set, drop, void call, br/br_if without value…).
  return { pre: [...flat.pre, rebuilt], value: makeNop() };
}

/**
 * An operand LIST, in evaluation order: one trivial value per slot. A `pop`
 * slot is a value already on the stack. The operands run first — a
 * multi-value producer fills its own slot with its LAST value and leaves the
 * earlier ones on the frame's stack, in the order wasm leaves them — and then
 * the `pop` slots take the stack's top, deepest slot first. That one rule
 * covers every `pop` the reader makes: a producer's earlier values just
 * before it (the reader gives one stack entry per VALUE), a value an earlier
 * statement left, and a value a producer nested in a LATER sibling leaves under
 * that sibling's result — in `(call $pick1 (pop) (i64.mul (pop) (call $pick1
 * …)))` the outer `pop` is what the inner `$pick1` leaves under the product
 * (`spec/fac` "fac-ssa"). Stack order is slot order, so reading it once every
 * operand has run assigns each `pop` its value.
 */
function flattenOperands(
  ops: readonly Expression[],
  ctx: Ctx,
  what = 'an operand list',
): { pre: Expression[]; values: Expression[] } {
  const values: Expression[] = new Array(ops.length);
  const pre: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.kind === ExpressionKind.Pop) continue;
    const f = flattenExpr(op, ctx);
    pre.push(...f.pre);
    if (f.values === undefined) {
      values[i] = f.value;
      continue;
    }
    values[i] = f.values[f.values.length - 1]!;
    ctx.stack.push(...f.values.slice(0, -1));
  }
  const pops = ops.flatMap((op, j) => op.kind === ExpressionKind.Pop ? [j] : []);
  take(pops.length, ctx, what).forEach((v, k) => values[pops[k]!] = v);
  return { pre, values };
}

// ---------------------------------------------------------------------------
// Value-carrying branches
// ---------------------------------------------------------------------------

/** Is `name` the function frame — a branch to it leaves the function? */
function isFrame(name: string, ctx: Ctx): boolean {
  // A prepared tree names the frame (`bodyFrameLabel`); a built one uses `''`.
  return name === (ctx.func.bodyFrameLabel ?? '') || name === '';
}

/** How many values a branch to `name` carries: the target's arity. */
function arityOf(name: string, ctx: Ctx): number {
  if (isFrame(name, ctx)) return ctx.func.sig.results.length;
  return ctx.branchTemps.get(name)?.types.length ?? 0;
}

/** Does this branch carry values — written, or taken from the stack? */
function carriesValues(br: BreakExpr | SwitchExpr, ctx: Ctx): boolean {
  if (br.values.length > 0) return true;
  const target = br.kind === ExpressionKind.Break ? br.target : br.defaultTarget;
  // Every target of a valid `br_table` takes the same arity: one tells.
  return arityOf(requireName(target, 'branch target'), ctx) > 0;
}

/** The temps a branch to `name` fills; a target that registered none is refused, not guessed. */
function targetTemps(name: string, ctx: Ctx): Temps {
  const t = ctx.branchTemps.get(name);
  if (t === undefined) {
    throw new Error(`Flatten: a value-carrying branch to "${name}", which yields no value`);
  }
  return t;
}

/** The function frame as a branch target: its result temps, made on first use. */
function frameTarget(ctx: Ctx): Temps & { label: string } {
  if (ctx.frame === null) {
    const types = ctx.func.sig.results as ValType[];
    ctx.frame = { temps: allocTemps(ctx, types), types: [...types], label: '$flatten$frame' };
  }
  return ctx.frame;
}

/** A branch's values: its written operands, or — none written — the stack's top. */
function branchValues(
  br: BreakExpr | SwitchExpr,
  n: number,
  ctx: Ctx,
): { pre: Expression[]; values: Expression[] } {
  if (br.values.length > 0) return flattenOperands(br.values, ctx);
  // An index or condition that never falls through made the stack polymorphic
  // BEFORE the values were taken — `(br_table 0 0 (unreachable))` to a result
  // block: a value missing there is dead code.
  const cond = br.condition;
  const polymorphic = ctx.polymorphic;
  if (cond !== undefined && neverFallsThrough(cond, ctx)) ctx.polymorphic = true;
  try {
    return { pre: [], values: take(n, ctx, `a value-less \`${br.kind}\``) };
  } finally {
    ctx.polymorphic = polymorphic;
  }
}

/**
 * `br $l (v…)` → `local.set $tmp…(v…); br $l`; `br_if $l (v…) (c)` → the same
 * with the condition, and the values that fall through when it is not taken
 * are the temps. To the FRAME, the values are the function's results: a `br`
 * is a `return`, a `br_if` an `if` around one.
 *
 * Wasm evaluates the values, then the condition. Both are flattened in that
 * order, and the target's temps are set only after the condition's prelude,
 * just before the branch: the condition may itself branch to the same target
 * and set the temps, and must not clobber the values this branch carries. They
 * are constants or FRESH temps by then, so reading them late reads what was
 * computed first.
 */
function flattenValueBreak(br: BreakExpr, ctx: Ctx): Flat {
  const name = requireName(br.target, 'branch target');
  const v = branchValues(br, arityOf(name, ctx), ctx);
  const cond = br.condition === undefined ? undefined : flattenOperands([br.condition], ctx);
  const pre = [...v.pre, ...(cond?.pre ?? [])];
  const fallThrough = (values: Expression[]): Flat =>
    values.length === 1 ? { pre, value: values[0]! } : { pre, value: makeNop(), values };
  if (isFrame(name, ctx)) {
    if (cond === undefined) {
      return { pre: [...pre, makeReturn(v.values)], value: makeUnreachable() };
    }
    const t: Temps = {
      temps: allocTemps(ctx, v.values.map((x) => typeOf(x) as ValType)),
      types: v.values.map((x) => typeOf(x) as ValType),
    };
    pre.push(
      ...setsOf(t, v.values),
      makeIf(cond.values[0]!, makeRegion([makeReturn(getsOf(t))]), null),
    );
    return fallThrough(getsOf(t));
  }
  const t = targetTemps(name, ctx);
  pre.push(...setsOf(t, v.values));
  if (cond === undefined) return { pre: [...pre, makeBreak(name)], value: makeUnreachable() };
  pre.push(makeBreak(name, cond.values[0]!));
  return fallThrough(getsOf(t));
}

/**
 * `br_table` with values: the values into the temps of EVERY target it may
 * take, then the `br_table` without them. A target that leaves the FUNCTION
 * is redirected to a block around the body ({@link frameTarget}) whose temps
 * the body's end returns — a `return` has no index to switch on.
 */
function flattenValueSwitch(sw: SwitchExpr, ctx: Ctx): Flat {
  const retarget = (t: Var): string => {
    const name = requireName(t, 'target');
    return isFrame(name, ctx) ? frameTarget(ctx).label : name;
  };
  const targets = sw.targets.map(retarget);
  const defaultTarget = retarget(sw.defaultTarget);
  const n = arityOf(requireName(sw.defaultTarget, 'target'), ctx);
  const v = branchValues(sw, n, ctx);
  const cond = flattenOperands([sw.condition], ctx);
  const sets = [...new Set([...targets, defaultTarget])].flatMap((name) =>
    setsOf(name === ctx.frame?.label ? ctx.frame : targetTemps(name, ctx), v.values)
  );
  const bare = makeSwitch(targets, defaultTarget, cond.values[0]!);
  return { pre: [...v.pre, ...cond.pre, ...sets, bare], value: makeUnreachable() };
}

// ---------------------------------------------------------------------------
// Control-flow structures
// ---------------------------------------------------------------------------

function flattenControlFlow(e: Expression, ctx: Ctx): Flat {
  switch (e.kind) {
    case ExpressionKind.Block:
      return flattenBlockLike((e as BlockExpr).children, typeOf(e), (e as BlockExpr).label, ctx);
    // A region in operand position flattens as an unnamed block of its
    // contents' type — `None` when they never fall through.
    case ExpressionKind.Region:
      return flattenBlockLike((e as RegionExpr).children, typeOf(e), '', ctx);
    case ExpressionKind.If:
      return flattenIf(e as IfExpr, ctx);
    case ExpressionKind.Loop:
      return flattenLoop(e as LoopExpr, ctx);
    case ExpressionKind.Try:
      return flattenTry(e as TryExpr, ctx);
    default:
      throw new Error(`flatten: unexpected control-flow kind ${e.kind}`);
  }
}

/**
 * A SEQUENCE in its own stack frame (`seed`: the values the format puts on the
 * stack at its entry). Each statement's preludes and body in order; a
 * statement that leaves values pushes them onto the frame's stack, where a
 * later `pop` or value-less branch takes them. The sequence's result is the
 * top `types.length` values at its end — `null` when the end is unreachable
 * (after a transfer or trap nothing falls through, and nothing is set).
 */
function flattenSeq(
  children: readonly Expression[],
  types: readonly ValType[],
  ctx: Ctx,
  seed: Expression[] = [],
): { stmts: Expression[]; results: Expression[] | null } {
  return inFrame(ctx, seed, () => {
    const stmts: Expression[] = [];
    for (const child of children) {
      // A `pop` directly in a sequence is not an instruction: it marks a stack
      // slot whose value STAYS — a multi-value producer's earlier value (the
      // producer pushes all of them), or a value left for the result. The
      // model already holds it.
      if (child.kind === ExpressionKind.Pop) continue;
      const f = flattenExpr(child, ctx);
      stmts.push(...f.pre);
      if (neverFallsThrough(child, ctx)) {
        // A transfer or trap: keep it as a statement (a trivial `unreachable`
        // has no prelude, and would vanish), and what the stack held is
        // abandoned — nothing after it here is reached.
        // Only the trap itself: a value computed after the transfer (`(i32.xor
        // (br 0 …) …)` leaves the xor's `local.get`) is dead, and as a
        // statement would leave a value at a void end.
        if (
          f.value.kind === ExpressionKind.Unreachable &&
          !f.pre.some((s) => typeOf(s) === Unreachable)
        ) {
          stmts.push(f.value);
        }
        ctx.stack = [];
        ctx.polymorphic = true;
        continue;
      }
      ctx.stack.push(...valuesOf(f));
    }
    if (ctx.polymorphic && ctx.stack.length < types.length) return { stmts, results: null };
    return { stmts, results: take(types.length, ctx, 'the end of a sequence') };
  });
}

/**
 * Does control never leave `e` forward? Typed `unreachable`, or a plain
 * instruction with an operand that never falls through — `(call_ref $t
 * (unreachable))` is typed by its signature, and the stack after it is
 * polymorphic all the same. A block, `if`, loop or `try` ends where its type
 * says, whatever its contents did.
 */
function neverFallsThrough(e: Expression, ctx: Ctx): boolean {
  if (callEffectiveType(e, ctx) === Unreachable) return true;
  if (isControlFlow(e)) return false;
  let never = false;
  mapChildrenShallow(e, (c) => {
    never ||= c.kind !== ExpressionKind.Pop && neverFallsThrough(c, ctx);
    return c;
  });
  return never;
}

/** A frame's result into its temps, and the construct's value(s) out of them. */
function resultFlat(pre: Expression[], t: Temps): Flat {
  const gets = getsOf(t);
  if (gets.length === 0) return { pre, value: makeNop() };
  if (gets.length === 1) return { pre, value: gets[0]! };
  return { pre, value: makeNop(), values: gets };
}

/** A block (or a region in operand position): its value through temps; a branch to its label fills the same ones. */
function flattenBlockLike(
  children: readonly Expression[],
  type: Type,
  label: string,
  ctx: Ctx,
): Flat {
  const types = valTypes(type);
  const t: Temps = { temps: allocTemps(ctx, types), types };
  if (types.length > 0 && label) ctx.branchTemps.set(label, t);
  const seq = flattenSeq(children, types, ctx);
  const list = [...seq.stmts, ...(seq.results === null ? [] : setsOf(t, seq.results))];
  return resultFlat([makeBlock(list, label || null)], t);
}

/** Flatten an `if`: a trivial condition, statement arms; values through temps. */
function flattenIf(iff: IfExpr, ctx: Ctx): Flat {
  const cond = flattenOperands([iff.condition], ctx);
  const types = valTypes(typeOf(iff));
  const t: Temps = { temps: allocTemps(ctx, types), types };
  // After the condition: the `if`'s label covers its arms, not its condition.
  if (types.length > 0 && iff.label) ctx.branchTemps.set(iff.label, t);

  const arm = (a: RegionExpr): RegionExpr => {
    const seq = flattenSeq(a.children, types, ctx);
    return makeRegion([...seq.stmts, ...(seq.results === null ? [] : setsOf(t, seq.results))]);
  };
  const ifTrue = arm(iff.ifTrue);
  const ifFalse = iff.ifFalse ? arm(iff.ifFalse) : null;
  // 🔧 Through `makeIf`, carrying the `if`'s LABEL. This was a literal without
  // the label, so a `br` inside that targeted the `if` itself lost its target
  // and the encoder threw "unresolved branch label" on a valid input.
  const flatIf = makeIf(cond.values[0]!, ifTrue, ifFalse, iff.label);
  return resultFlat([...cond.pre, flatIf], t);
}

/** Flatten a `loop`: the body a statement sequence; values through temps. */
function flattenLoop(loop: LoopExpr, ctx: Ctx): Flat {
  const types = valTypes(typeOf(loop));
  const t: Temps = { temps: allocTemps(ctx, types), types };
  const seq = flattenSeq(loop.body.children, types, ctx);
  const body = [...seq.stmts, ...(seq.results === null ? [] : setsOf(t, seq.results))];
  return resultFlat([makeLoop(loop.label, makeRegion(body))], t);
}

/**
 * Flatten a legacy `try`: the body and each handler statement sequences;
 * values through temps, as a block's. A `catch $tag` handler is ENTERED with
 * the tag's payload on the stack: it is captured first — `local.set` of each
 * value, deepest last, taking a `pop` — and the handler's own `pop`s read the
 * temps. Upstream keeps the `pop` first in the handler the same way.
 */
function flattenTry(tr: TryExpr, ctx: Ctx): Flat {
  const types = valTypes(typeOf(tr));
  const t: Temps = { temps: allocTemps(ctx, types), types };
  if (types.length > 0 && tr.label) ctx.branchTemps.set(tr.label, t);
  const region = (
    children: readonly Expression[],
    entry: Expression[] = [],
    seed: Expression[] = [],
  ) => {
    const seq = flattenSeq(children, types, ctx, seed);
    return makeRegion([
      ...entry,
      ...seq.stmts,
      ...(seq.results === null ? [] : setsOf(t, seq.results)),
    ]);
  };
  const catches = tr.catches.map((c): Catch => {
    if (c.isRef) throw new Error('flatten: a legacy catch_ref is not supported');
    const payload = c.tag === undefined ? [] : ctx.tagParams.get(requireName(c.tag, 'catch tag'));
    if (payload === undefined) {
      throw new Error(`Flatten: unresolved catch tag "${requireName(c.tag!, 'catch tag')}"`);
    }
    const cap = payload.length === 0 ? { pre: [], values: [] } : capture(makeNop(), payload, ctx);
    return { ...c, body: region(c.body.children, cap.pre.slice(1), cap.values) };
  });
  const flatTry: TryExpr = { ...tr, type: None, body: region(tr.body.children), catches };
  return resultFlat([flatTry], t);
}

// ---------------------------------------------------------------------------
// Function driver + pass
// ---------------------------------------------------------------------------

/**
 * Build the direct-call result-type map (`funcName → result type`) a module
 * needs for flattening — imports and defined functions. Pass it to
 * {@link flattenFunction}; the {@link FlattenPass} builds it automatically.
 * A multi-result signature is kept WHOLE, as a tuple.
 */
export function buildCallResultTypes(module: WasmModule): Map<string, Type> {
  const map = new Map<string, Type>();
  const resultType = (results: ValueType[] | undefined): Type => {
    if (results === undefined || results.length === 0) return None;
    return results.length === 1 ? results[0]! : (results as Type);
  };
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) map.set(imp.func.name, resultType(imp.func.sig.results));
  }
  for (const f of module.functions) {
    map.set(f.name, resultType(f.sig.results));
  }
  return map;
}

/** Each tag's parameter types, by name — imports and defined tags. */
export function buildTagParams(module: WasmModule): Map<string, ValType[]> {
  const map = new Map<string, ValType[]>();
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Tag) map.set(imp.tag.name, imp.tag.sig.params as ValType[]);
  }
  for (const tag of module.tags) map.set(tag.name, tag.sig.params as ValType[]);
  return map;
}

/**
 * Flatten a single function body in place. `callResultTypes` maps direct-call
 * targets to their result type (see {@link buildCallResultTypes}); when omitted
 * calls are treated as void (correct only for modules with no value-returning
 * calls). `tagParams` gives a legacy `catch`'s payload types
 * ({@link buildTagParams}).
 */
export function flattenFunction(
  func: WasmFunction,
  callResultTypes: Map<string, Type> = new Map(),
  tagParams: Map<string, ValType[]> = new Map(),
): void {
  const ctx: Ctx = {
    func,
    callResultTypes,
    tagParams,
    branchTemps: new Map(),
    frame: null,
    stack: [],
    polymorphic: false,
  };
  const results = func.sig.results as ValType[];
  // The body's value is the function's result; route it through a `return`
  // (matching upstream), so the body ends as a statement.
  const seq = flattenSeq(func.body.children, results, ctx);
  let list = seq.stmts;
  if (seq.results !== null && results.length > 0) list.push(makeReturn(seq.results));
  // A branch that may leave the function with values went to a block around
  // the body instead: its end returns the frame's temps.
  if (ctx.frame !== null) {
    list = [makeBlock(list, ctx.frame.label), makeReturn(getsOf(ctx.frame))];
  }
  // A function with results whose body never falls through (it ends in a
  // `return`, a `br` to the frame, a trap) must end on something typed
  // `unreachable`, or the validator sees `[]` fall through where the signature
  // wants values. Binaryen types such a body `unreachable` and its writer emits
  // an `unreachable` after it; this tree has to say so itself. Never executed.
  // 🔧 131 of 2,919 modules came out INVALID, silently ("expected 1 elements
  // on the stack for fallthru"), from `(func (result i32) … return)`.
  if (results.length > 0 && typeOf(list.at(-1) ?? makeNop()) !== Unreachable) {
    list.push(makeUnreachable());
  }
  func.body = makeRegion(list);
}

/** Rewrites every function in the module into Flat IR. */
export class FlattenPass implements Pass {
  readonly name = 'Flatten';
  readonly description =
    'Rewrites functions into Flat IR: every value-producing subexpression is ' +
    'hoisted into its own local, operands become trivial, and control flow ' +
    "routes values through temp locals. Port of Binaryen's --flatten.";
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    const callResultTypes = buildCallResultTypes(module);
    const tagParams = buildTagParams(module);
    for (const func of module.functions) {
      flattenFunction(func, callResultTypes, tagParams);
    }
  }
}

registerPass(FlattenPass);
