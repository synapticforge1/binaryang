/**
 * @module binaryen-ts/passes/flatten
 *
 * Flatten pass — rewrites each function into **Flat IR**, the form in which:
 *
 *  - every side-effecting or value-producing subexpression is hoisted into its
 *    own `local.set $tmp (...)` statement, and used via `local.get $tmp`;
 *  - operands are therefore always *trivial* (a `local.get` or a constant);
 *  - control-flow structures (`block` / `if` / `loop`) are statements whose
 *    value, if any, flows out through a temp local; their conditions are
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
 * Because Flat IR intentionally introduces many temp locals (later cleaned up
 * by `simplify-locals` / `coalesce-locals`), this pass does not attempt to
 * match upstream's exact temp numbering; it produces behaviorally-equivalent,
 * invariant-satisfying Flat IR.
 *
 * ## Not yet supported
 *
 * Exception handling (`try` / `try_table` / `pop`), the legacy `br_on`,
 * multivalue/tuple results, and value-carrying branches (`br`/`br_if`/`br_table`
 * with a value) throw rather than being silently mishandled. The driving use
 * case — TinyGo goroutine code (loops / ifs / calls / locals, no EH/tuples) —
 * is fully covered.
 *
 * @license MIT
 */

import {
  asStatement,
  type BlockExpr,
  type BreakExpr,
  type CallExpr,
  type CallIndirectExpr,
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
  makeRegion,
  makeReturn,
  makeSwitch,
  makeUnreachable,
  type RegionExpr,
  type SwitchExpr,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { None, type Type, Unreachable, type ValType } from '../ir/types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { mapChildrenShallow } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { blockResult, requireName, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** A concrete (single-value) type — produces a value that can be stored in a local. */
function isConcrete(t: Type): boolean {
  return t !== None && t !== Unreachable;
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
    e.kind === ExpressionKind.Loop;
}

/** Kinds this port does not yet flatten — fail loud rather than mishandle. */
function rejectUnsupported(e: Expression): void {
  switch (e.kind) {
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
    case ExpressionKind.Pop:
    case ExpressionKind.BrOn:
      throw new Error(`flatten: ${e.kind} is not yet supported by this port.`);
  }
}

// ---------------------------------------------------------------------------
// Flatten context (per function)
// ---------------------------------------------------------------------------

interface Ctx {
  func: WasmFunction;
  /**
   * Maps a direct-call target name to its result type. The WAT/binary parser
   * leaves `Call.type === none` (the callee's result is implicit in wasm), so
   * flatten must resolve it here to know whether a call produces a value that
   * needs hoisting into a local.
   */
  callResultTypes: Map<string, Type>;
  /**
   * The temp that receives a value-carrying branch's value, by the LABEL of
   * the block or `if` it targets — the same temp the construct's own
   * fall-through value is routed into (upstream's `getTempForBreakTarget`).
   * Registered when the construct is entered; a label names one construct.
   */
  branchTemps: Map<string, { temp: number; type: Type }>;
}

/**
 * The effective result type of a (possibly type-`none`) call node.
 *
 * Flatten hoists a value-producing expression into ONE temporary local, so a
 * multi-result call has no representation here — a single local cannot hold N
 * values, and taking `results[0]` (as this did) would silently drop the rest
 * and leave the operand stack short. Multi-result calls are decodable now, so
 * this has to fail loudly rather than mis-hoist.
 *
 * An unresolvable direct-call target is likewise an error, not `none`:
 * `buildCallResultTypes` registers every import and defined function, so a miss
 * means a dangling target. Typing it `none` silently discarded the call's
 * value — the same defect the WAT parser's `inferFuncResultType` stub caused.
 */
function callEffectiveType(e: Expression, ctx: Ctx): Type {
  if (e.kind === ExpressionKind.Call) {
    const target = requireName((e as CallExpr).func, 'call target');
    const t = ctx.callResultTypes.get(target);
    if (t === undefined) {
      throw new Error(`Flatten: unresolved call target "${target}"`);
    }
    if (Array.isArray(t) && t.length > 1) {
      throw new Error(
        `Flatten: call to "${target}" returns ${t.length} values; ` +
          `multi-result calls cannot be hoisted into a single local`,
      );
    }
    return t;
  }
  if (e.kind === ExpressionKind.CallIndirect) {
    const r = (e as CallIndirectExpr).sig.results;
    if (r.length > 1) {
      throw new Error(
        `Flatten: call_indirect returns ${r.length} values; ` +
          `multi-result calls cannot be hoisted into a single local`,
      );
    }
    return r[0] ?? None;
  }
  if (e.kind === ExpressionKind.CallRef) {
    const t = typeOf(e);
    if (Array.isArray(t) && t.length > 1) {
      throw new Error(
        `Flatten: call_ref returns ${t.length} values; ` +
          `multi-result calls cannot be hoisted into a single local`,
      );
    }
    return t;
  }
  return typeOf(e);
}

/**
 * Allocate a fresh local of `type` and return its index.
 *
 * A TUPLE — a multi-value block, `if`, `loop` or function body — has no local
 * to hold it, as a multi-result call has none (`callEffectiveType`). 🔧 One was
 * allocated anyway: a local no value type can spell, which the writer's
 * resolver met as an internal crash ("Cannot read properties of undefined") on
 * 47 of 2,919 modules. Refused here, by name.
 */
function allocTemp(ctx: Ctx, type: Type): number {
  if (Array.isArray(type)) {
    throw new Error(
      `Flatten: a ${type.length}-value result cannot be hoisted into a single local ` +
        `(in "${ctx.func.name}"); multi-value blocks and bodies are not yet supported by this port.`,
    );
  }
  const idx = ctx.func.locals.length;
  ctx.func.locals.push({ type: type as ValType });
  return idx;
}

/** The result of flattening one expression. */
interface Flat {
  /** Statements to run, in order, before `value` is available. */
  pre: Expression[];
  /** A trivial value expression (or `nop` when the source was void). */
  value: Expression;
}

// ---------------------------------------------------------------------------
// Core recursion
// ---------------------------------------------------------------------------

function flattenExpr(e: Expression, ctx: Ctx): Flat {
  rejectUnsupported(e);

  // Constants / nop / unreachable are already trivial.
  if (isTrivial(e)) return { pre: [], value: e };

  if (isControlFlow(e)) return flattenControlFlow(e, ctx);

  // local.tee is disallowed in Flat IR: rewrite to a set (prelude) + get.
  // The result must read a FRESH temp, not `local.get tee.index`: returning the
  // original local left the value clobberable by a later sibling operand whose
  // own prelude writes the same local (e.g. two tees to the same local as
  // sibling operands) → the parent read the wrong value. Capture into a temp
  // that nothing else writes, mirroring the general-case hoist below.
  if (e.kind === ExpressionKind.LocalTee) {
    const tee = e as { var: Var; value: Expression; type: Type };
    const inner = flattenExpr(tee.value, ctx);
    const temp = allocTemp(ctx, tee.type);
    return {
      pre: [
        ...inner.pre,
        makeLocalSet(varIndex(temp), inner.value),
        makeLocalSet(tee.var, makeLocalGet(varIndex(temp), tee.type as ValType)),
      ],
      value: makeLocalGet(varIndex(temp), tee.type as ValType),
    };
  }

  // Value-carrying branches: the value goes into the target's temp, and the
  // branch goes without it (upstream Flatten's shape).
  if (e.kind === ExpressionKind.Break && (e as BreakExpr).values.length > 0) {
    return flattenValueBreak(e as BreakExpr, ctx);
  }
  if (e.kind === ExpressionKind.Switch && (e as SwitchExpr).values.length > 0) {
    return flattenValueSwitch(e as SwitchExpr, ctx);
  }

  // General case: flatten each child (eval order), collecting their preludes,
  // then reduce the rebuilt node according to its type.
  const childPre: Expression[] = [];
  const rebuilt = mapChildrenShallow(e, (child) => {
    const f = flattenExpr(child, ctx);
    childPre.push(...f.pre);
    return f.value;
  });

  if (rebuilt.type === Unreachable) {
    return { pre: [...childPre, rebuilt], value: makeUnreachable() };
  }
  // Calls carry `type === none` from the parser; resolve their true result type.
  const effType = callEffectiveType(rebuilt, ctx);
  if (isConcrete(effType)) {
    const temp = allocTemp(ctx, effType);
    return {
      pre: [...childPre, makeLocalSet(varIndex(temp), rebuilt)],
      value: makeLocalGet(varIndex(temp), effType as ValType),
    };
  }
  // Void statement (store, local.set, drop, void call, br/br_if without value…).
  return { pre: [...childPre, rebuilt], value: makeNop() };
}

// ---------------------------------------------------------------------------
// Value-carrying branches
// ---------------------------------------------------------------------------

/** Is `name` the function frame — a branch to it leaves the function? */
function isFrame(name: string, ctx: Ctx): boolean {
  // A prepared tree names the frame (`bodyFrameLabel`); a built one uses `''`.
  return name === (ctx.func.bodyFrameLabel ?? '') || name === '';
}

/** The one value a branch carries, flattened — several are a tuple, which no local holds. */
function branchValue(values: Expression[], what: string, ctx: Ctx): Flat {
  if (values.length > 1) {
    throw new Error(
      `Flatten: a ${what} carrying ${values.length} values cannot route them through one local ` +
        `(in "${ctx.func.name}"); multi-value branches are not yet supported by this port.`,
    );
  }
  return flattenExpr(values[0]!, ctx);
}

/** The temp a branch to `name` fills; a target that registered none is refused, not guessed. */
function targetTemp(name: string, ctx: Ctx): { temp: number; type: Type } {
  const t = ctx.branchTemps.get(name);
  if (t === undefined) {
    throw new Error(`Flatten: a value-carrying branch to "${name}", which yields no value`);
  }
  return t;
}

/**
 * `br $l (v)` → `local.set $tmp(v); br $l`; `br_if $l (v) (c)` → the same with
 * the condition, and the value that falls through when it is not taken is
 * `local.get $tmp`. To the FRAME, the value is the function's result: a `br`
 * is a `return`, a `br_if` an `if` around one.
 *
 * Wasm evaluates the value, then the condition. Both are flattened in that
 * order, and the target's temp is set only after the condition's prelude, just
 * before the branch: the condition may itself branch to the same target and
 * set the temp, and must not clobber the value this branch carries. The value
 * is a constant or a FRESH temp by then, so reading it late reads what was
 * computed first.
 */
function flattenValueBreak(br: BreakExpr, ctx: Ctx): Flat {
  const name = requireName(br.target, 'branch target');
  const v = branchValue(br.values, 'branch', ctx);
  const cond = br.condition === undefined ? undefined : flattenExpr(br.condition, ctx);
  const pre = [...v.pre, ...(cond?.pre ?? [])];
  if (isFrame(name, ctx)) {
    if (cond === undefined) {
      return { pre: [...pre, makeReturn([v.value])], value: makeUnreachable() };
    }
    const type = typeOf(v.value);
    const temp = allocTemp(ctx, type);
    const get = () => makeLocalGet(varIndex(temp), type as ValType);
    return {
      pre: [
        ...pre,
        makeLocalSet(varIndex(temp), v.value),
        makeIf(cond.value, makeRegion([makeReturn([get()])]), null),
      ],
      value: get(),
    };
  }
  const { temp, type } = targetTemp(name, ctx);
  pre.push(makeLocalSet(varIndex(temp), v.value));
  if (cond === undefined) return { pre: [...pre, makeBreak(name)], value: makeUnreachable() };
  return {
    pre: [...pre, makeBreak(name, cond.value)],
    value: makeLocalGet(varIndex(temp), type as ValType),
  };
}

/**
 * `br_table` with a value: the value into the temp of EVERY target it may
 * take, then the `br_table` without it. A table that may leave the function
 * with a value is refused — a `return` has no index to switch on.
 */
function flattenValueSwitch(sw: SwitchExpr, ctx: Ctx): Flat {
  const v = branchValue(sw.values, 'br_table', ctx);
  const cond = flattenExpr(sw.condition, ctx);
  const names = [
    ...new Set([...sw.targets, sw.defaultTarget].map((t) => requireName(t, 'target'))),
  ];
  if (names.some((n) => isFrame(n, ctx))) {
    throw new Error(
      `Flatten: a value-carrying br_table to the function frame (in "${ctx.func.name}") ` +
        `is not yet supported by this port.`,
    );
  }
  const sets = names.map((n) => makeLocalSet(varIndex(targetTemp(n, ctx).temp), v.value));
  const bare = makeSwitch(
    sw.targets.map((t) => requireName(t, 'target')),
    requireName(
      sw.defaultTarget,
      'target',
    ),
    cond.value,
  );
  return { pre: [...v.pre, ...cond.pre, ...sets, bare], value: makeUnreachable() };
}

// ---------------------------------------------------------------------------
// Control-flow structures
// ---------------------------------------------------------------------------

function flattenControlFlow(e: Expression, ctx: Ctx): Flat {
  switch (e.kind) {
    case ExpressionKind.Block:
      return flattenBlock(e as BlockExpr, ctx);
    // A region flattens as its one instruction, or as an unnamed block of
    // several (`asStatement`) — the shapes upstream's parser hands its Flatten,
    // and the ones this port's parsers produced before regions were a kind, so
    // the Flat IR that asyncify mirrors against `wasm-opt` is unchanged.
    // A block of several declares the region's contents' type — `None` when
    // they never fall through, which is what such a block declares.
    case ExpressionKind.Region:
      return flattenExpr(
        asStatement(e, e.type === undefined || e.type === Unreachable ? None : e.type),
        ctx,
      );
    case ExpressionKind.If:
      return flattenIf(e as IfExpr, ctx);
    case ExpressionKind.Loop:
      return flattenLoop(e as LoopExpr, ctx);
    default:
      throw new Error(`flatten: unexpected control-flow kind ${e.kind}`);
  }
}

/**
 * Flatten a block. Non-last children are statements: their preludes and (void)
 * bodies are appended in order. If the block is concrete, the last child's
 * value is routed into a result temp and the block becomes a void statement;
 * the block's value flows out via `local.get $temp`.
 */
function flattenBlock(block: BlockExpr, ctx: Ctx): Flat {
  const concrete = isConcrete(typeOf(block));
  const resultTemp = concrete ? allocTemp(ctx, typeOf(block)) : -1;
  // A branch to this block carrying a value fills the same temp.
  if (concrete && block.label) {
    ctx.branchTemps.set(block.label, { temp: resultTemp, type: typeOf(block) });
  }
  const list: Expression[] = [];
  // WHICH child yields the block's value: the last one, unless it is a void
  // statement — in stack form a value may sit on the stack while void
  // statements after it run (`(call $v) (i32.const 3) (nop)` yields 3). Then it
  // is the last child that produces a value, with only void ones after it.
  // 🔧 This took the LAST child always, and wrote `local.set $tmp (nop)` —
  // INVALID (`spec/nop/nop.0`, `local_tee.0`; reached once value-carrying
  // branches stopped refusing those modules first).
  const kids = block.children;
  let valueAt = kids.length - 1;
  if (concrete && kids.length > 0 && callEffectiveType(kids[valueAt]!, ctx) === None) {
    for (let i = kids.length - 2; i >= 0; i--) {
      const t = callEffectiveType(kids[i]!, ctx);
      if (t === None) continue;
      if (isConcrete(t)) valueAt = i;
      break;
    }
  }

  block.children.forEach((child, i) => {
    // Any OTHER child that leaves a value: in a valid module something later
    // takes it implicitly, from the stack (stack-form code the reader keeps —
    // `(local.get 0) (nop) (br_if 0 (local.get 0))`, whose `br_if` shows no
    // value). Flat IR routes values through locals, never the stack, and
    // discarding it — as this did — loses an operand: INVALID output
    // (`spec/nop/nop.0`). Refused by name; upstream's IR has no such code.
    if (i !== valueAt || !concrete) {
      const t = callEffectiveType(child, ctx);
      if (isConcrete(t) && !abandoned(kids, i, ctx)) {
        throw new Error(
          `Flatten: a value left on the stack for a later instruction (stack-form code, in ` +
            `"${ctx.func.name}") is not yet supported by this port.`,
        );
      }
    }
    const f = flattenExpr(child, ctx);
    list.push(...f.pre);
    if (i === valueAt && concrete) {
      list.push(makeLocalSet(varIndex(resultTemp), f.value));
    } else if (child.type === Unreachable) {
      // A non-last `unreachable` (e.g. a bare `unreachable`, or the value of a
      // call to a noreturn fn) is trivial with an empty prelude, so it would
      // otherwise vanish. Keep it as a statement — it carries the trap and
      // terminates control flow; dropping it lets execution fall through.
      list.push(f.value);
    }
    // (A non-value child that leaves a value was refused above; this comment
    // used to say such a value "has no effect — discard it", which lost a
    // stack operand.) Void children: their statement is already in `f.pre`
    // (general case emits the rebuilt node into pre), so nothing else to push.
  });

  const flatBlock = makeBlock(list, block.label);
  return concrete
    ? { pre: [flatBlock], value: makeLocalGet(varIndex(resultTemp), block.type as ValType) }
    : { pre: [flatBlock], value: makeNop() };
}

/**
 * Is the value `kids[i]` leaves ABANDONED — discarded by what follows, taken by
 * nothing? It is when the next child that is not a void statement is a
 * stack-polymorphic transfer (typed `unreachable`: `unreachable`, `return`, a
 * `br`, a `throw`) that takes nothing from the stack. Its side effects stay
 * (they are in the prelude); only the value, which nothing reads, goes.
 * `(unary) (unary) (unreachable)` and `(local.tee …) (return (i32.const -1))`
 * are that shape (`spec/binary-leb128`, `spec/br_if`). (A `pop` operand —
 * "already on the stack" — never reaches here: the spill before Flatten turns
 * it into a local, and one it cannot is refused by `rejectUnsupported`.)
 */
function abandoned(kids: readonly Expression[], i: number, ctx: Ctx): boolean {
  for (let j = i + 1; j < kids.length; j++) {
    const next = kids[j]!;
    const t = callEffectiveType(next, ctx);
    // Void statements, and other values that take nothing (a run of leftovers
    // before the trap, `spec/binary-leb128`), leave this one where it is.
    if (t === None || isConcrete(t)) continue;
    return typeOf(next) === Unreachable && !branchTakesFromStack(next, ctx);
  }
  return false;
}

/**
 * A `br` or `br_table` that shows no value but targets a construct that takes
 * one: in stack form it takes that value from the stack. 🔧 `abandoned` read
 * `(block (result i32) local.get 0 nop br 0)`'s `br` as a trap that discards
 * the value — the output was VALID and returned the result temp's zero.
 */
function branchTakesFromStack(e: Expression, ctx: Ctx): boolean {
  let target: Var;
  if (e.kind === ExpressionKind.Break && (e as BreakExpr).values.length === 0) {
    target = (e as BreakExpr).target;
  } else if (e.kind === ExpressionKind.Switch && (e as SwitchExpr).values.length === 0) {
    // Every target of a valid `br_table` takes the same arity: one tells.
    target = (e as SwitchExpr).defaultTarget;
  } else {
    return false;
  }
  const n = requireName(target, 'branch target');
  return ctx.branchTemps.has(n) || (isFrame(n, ctx) && ctx.func.sig.results.length > 0);
}

/** Flatten an `if`: trivial condition + statement arms; value via a temp. */
function flattenIf(iff: IfExpr, ctx: Ctx): Flat {
  const cond = flattenExpr(iff.condition, ctx);
  const concrete = isConcrete(typeOf(iff));
  const resultTemp = concrete ? allocTemp(ctx, typeOf(iff)) : -1;
  // After the condition: the `if`'s label covers its arms, not its condition.
  if (concrete && iff.label) {
    ctx.branchTemps.set(iff.label, { temp: resultTemp, type: typeOf(iff) });
  }

  const arm = (a: RegionExpr): RegionExpr => {
    const f = flattenExpr(a, ctx);
    const stmts = [...f.pre];
    if (concrete && isConcrete(typeOf(a))) stmts.push(makeLocalSet(varIndex(resultTemp), f.value));
    // 🔧 An arm of one `unreachable` flattens to that trivial VALUE with an
    // empty prelude; keeping only concrete values dropped it, and the arm fell
    // through instead of trapping (`spec/unreachable` "as-if-then").
    else if (typeOf(f.value) === Unreachable) stmts.push(f.value);
    return makeRegion(stmts);
  };

  const ifTrue = arm(iff.ifTrue);
  const ifFalse = iff.ifFalse ? arm(iff.ifFalse) : null;
  // 🔧 Through `makeIf`, carrying the `if`'s LABEL. This was a literal without
  // the label, so a `br` inside that targeted the `if` itself lost its target
  // and the encoder threw "unresolved branch label" on a valid input.
  const flatIf = makeIf(cond.value, ifTrue, ifFalse, iff.label);

  return concrete
    ? { pre: [...cond.pre, flatIf], value: makeLocalGet(varIndex(resultTemp), iff.type as ValType) }
    : { pre: [...cond.pre, flatIf], value: makeNop() };
}

/** Flatten a `loop`: body becomes a statement block; value via a temp. */
function flattenLoop(loop: LoopExpr, ctx: Ctx): Flat {
  const concrete = isConcrete(typeOf(loop));
  const resultTemp = concrete ? allocTemp(ctx, typeOf(loop)) : -1;

  const f = flattenExpr(loop.body, ctx);
  const stmts = [...f.pre];
  if (concrete && isConcrete(typeOf(loop.body))) {
    stmts.push(makeLocalSet(varIndex(resultTemp), f.value));
  } else if (typeOf(f.value) === Unreachable) {
    // The same trap as an `if` arm's: `(loop (unreachable))` flattens to a
    // trivial value that nothing else would keep.
    stmts.push(f.value);
  }

  const flatLoop = makeLoop(loop.label, makeRegion(stmts));

  return concrete
    ? { pre: [flatLoop], value: makeLocalGet(varIndex(resultTemp), loop.type as ValType) }
    : { pre: [flatLoop], value: makeNop() };
}

// ---------------------------------------------------------------------------
// Function driver + pass
// ---------------------------------------------------------------------------

/**
 * Build the direct-call result-type map (`funcName → result type`) a module
 * needs for flattening — imports and defined functions. Pass it to
 * {@link flattenFunction}; the {@link FlattenPass} builds it automatically.
 */
export function buildCallResultTypes(module: WasmModule): Map<string, Type> {
  const map = new Map<string, Type>();
  // Record the FULL result list, not `results[0]`. Collapsing a multi-result
  // signature to its first component made a 2-result call look like a plain
  // i32 call, which `callEffectiveType` would then hoist into one local —
  // dropping the second value. Keeping the tuple lets that function reject it.
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

/**
 * Flatten a single function body in place. `callResultTypes` maps direct-call
 * targets to their result type (see {@link buildCallResultTypes}); when omitted
 * calls are treated as void (correct only for modules with no value-returning
 * calls).
 */
export function flattenFunction(
  func: WasmFunction,
  callResultTypes: Map<string, Type> = new Map(),
): void {
  const ctx: Ctx = { func, callResultTypes, branchTemps: new Map() };
  // A value-returning function body yields the return value; route it through a
  // `return` (matching upstream) so the body block ends up void. Guard on the
  // result signature, not `body.type`, since a call-bodied function has
  // `body.type === none` from the parser.
  const bodyIsValue = func.sig.results.length > 0 && func.body.type !== Unreachable;
  // Unwrapped, not placed as is: `return` takes an OPERAND, which a region
  // cannot be — and `makeReturn(region)` type-checks, since a region is an
  // Expression.
  const body = asStatement(func.body, bodyIsValue ? blockResult(func.sig.results) : None);
  const source = bodyIsValue ? makeReturn([body]) : body;

  const f = flattenExpr(source, ctx);
  const list = [...f.pre];
  // If the source was void and produced a trailing non-nop value, keep it.
  if (!bodyIsValue && f.value.kind !== ExpressionKind.Nop) list.push(f.value);
  // A function with results whose body never falls through (it ends in a
  // `return`, a `br` to the frame, a trap) was flattened as a VOID statement:
  // the body now ends on a void block, and the wasm validator sees `[]` fall
  // through where the signature wants values. Binaryen types that block
  // `unreachable` and its writer emits an `unreachable` after it; this tree has
  // to say so itself. Never executed — nothing reaches the end.
  // 🔧 131 of 2,919 modules came out INVALID, silently ("expected 1 elements
  // on the stack for fallthru"), from `(func (result i32) … return)`.
  if (
    !bodyIsValue && func.sig.results.length > 0 && typeOf(list.at(-1) ?? makeNop()) !== Unreachable
  ) {
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
    for (const func of module.functions) {
      flattenFunction(func, callResultTypes);
    }
  }
}

registerPass(FlattenPass);
