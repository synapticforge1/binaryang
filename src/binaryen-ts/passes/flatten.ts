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
  makeIf,
  makeLocalGet,
  makeLocalSet,
  makeLoop,
  makeNop,
  makeRegion,
  makeReturn,
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
import { requireName, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';

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
    const target = requireName((e as CallExpr).target, 'call target');
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
    const r = (e as CallIndirectExpr).results;
    if (r.length > 1) {
      throw new Error(
        `Flatten: call_indirect returns ${r.length} values; ` +
          `multi-result calls cannot be hoisted into a single local`,
      );
    }
    return r[0] ?? None;
  }
  return typeOf(e);
}

/** Allocate a fresh local of `type` and return its index. */
function allocTemp(ctx: Ctx, type: Type): number {
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
    const tee = e as { index: Var; value: Expression; type: Type };
    const inner = flattenExpr(tee.value, ctx);
    const temp = allocTemp(ctx, tee.type);
    return {
      pre: [
        ...inner.pre,
        makeLocalSet(varIndex(temp), inner.value),
        makeLocalSet(tee.index, makeLocalGet(varIndex(temp), tee.type as ValType)),
      ],
      value: makeLocalGet(varIndex(temp), tee.type as ValType),
    };
  }

  // Value-carrying branches need break-target temps — not yet supported.
  if (e.kind === ExpressionKind.Break && (e as BreakExpr).values.length > 0) {
    throw new Error('flatten: value-carrying br/br_if is not yet supported by this port.');
  }
  if (e.kind === ExpressionKind.Switch && (e as SwitchExpr).values.length > 0) {
    throw new Error('flatten: value-carrying br_table is not yet supported by this port.');
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
    case ExpressionKind.Region:
      return flattenExpr(asStatement(e), ctx);
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
  const list: Expression[] = [];

  block.children.forEach((child, i) => {
    const isLast = i === block.children.length - 1;
    const f = flattenExpr(child, ctx);
    list.push(...f.pre);
    if (isLast && concrete) {
      list.push(makeLocalSet(varIndex(resultTemp), f.value));
    } else if (child.type === Unreachable) {
      // A non-last `unreachable` (e.g. a bare `unreachable`, or the value of a
      // call to a noreturn fn) is trivial with an empty prelude, so it would
      // otherwise vanish. Keep it as a statement — it carries the trap and
      // terminates control flow; dropping it lets execution fall through.
      list.push(f.value);
    }
    // A non-last concrete child (rare, e.g. a dropped value mid-block that
    // reduced to a local.get) has no effect — discard its trivial value.
    // Void children: their statement is already in `f.pre` (general case emits
    // the rebuilt node into pre), so nothing else to push.
  });

  const flatBlock = makeBlock(list, block.name);
  return concrete
    ? { pre: [flatBlock], value: makeLocalGet(varIndex(resultTemp), block.type as ValType) }
    : { pre: [flatBlock], value: makeNop() };
}

/** Flatten an `if`: trivial condition + statement arms; value via a temp. */
function flattenIf(iff: IfExpr, ctx: Ctx): Flat {
  const cond = flattenExpr(iff.condition, ctx);
  const concrete = isConcrete(typeOf(iff));
  const resultTemp = concrete ? allocTemp(ctx, typeOf(iff)) : -1;

  const arm = (a: RegionExpr): RegionExpr => {
    const f = flattenExpr(a, ctx);
    const stmts = [...f.pre];
    if (concrete && isConcrete(typeOf(a))) stmts.push(makeLocalSet(varIndex(resultTemp), f.value));
    return makeRegion(stmts);
  };

  const ifTrue = arm(iff.ifTrue);
  const ifFalse = iff.ifFalse ? arm(iff.ifFalse) : null;
  // 🔧 Through `makeIf`, carrying the `if`'s LABEL. This was a literal without
  // `name`, so a `br` inside that targeted the `if` itself lost its target and
  // the encoder threw "unresolved branch label" on a valid input.
  const flatIf = makeIf(cond.value, ifTrue, ifFalse, iff.name);

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
  }

  const flatLoop = makeLoop(loop.name, makeRegion(stmts));

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
    if (imp.kind === 'function') map.set(imp.name, resultType(imp.results));
  }
  for (const f of module.functions) {
    map.set(f.name, resultType(f.results));
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
  const ctx: Ctx = { func, callResultTypes };
  // A value-returning function body yields the return value; route it through a
  // `return` (matching upstream) so the body block ends up void. Guard on the
  // result signature, not `body.type`, since a call-bodied function has
  // `body.type === none` from the parser.
  const bodyIsValue = func.results.length > 0 && func.body.type !== Unreachable;
  // Unwrapped, not placed as is: `return` takes an OPERAND, which a region
  // cannot be — and `makeReturn(region)` type-checks, since a region is an
  // Expression.
  const body = asStatement(func.body);
  const source = bodyIsValue ? makeReturn([body]) : body;

  const f = flattenExpr(source, ctx);
  const list = [...f.pre];
  // If the source was void and produced a trailing non-nop value, keep it.
  if (!bodyIsValue && f.value.kind !== ExpressionKind.Nop) list.push(f.value);
  func.body = makeRegion(list);
}

/** Rewrites every function in the module into Flat IR. */
export class FlattenPass implements Pass {
  readonly name = 'Flatten';
  readonly description =
    'Rewrites functions into Flat IR: every value-producing subexpression is ' +
    'hoisted into its own local, operands become trivial, and control flow ' +
    "routes values through temp locals. Port of Binaryen's --flatten.";
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const callResultTypes = buildCallResultTypes(module);
    for (const func of module.functions) {
      flattenFunction(func, callResultTypes);
    }
  }
}

registerPass(FlattenPass);
