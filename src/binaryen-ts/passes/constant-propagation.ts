/**
 * @module binaryen-ts/passes/constant-propagation
 *
 * ConstantPropagation pass — a `local.get` whose only reaching value is one
 * constant becomes that constant.
 *
 * A forward analysis over {@link buildCFG}'s blocks, one lattice value per
 * local: not reached yet, ONE constant, or not a constant. A `local.set` /
 * `local.tee` of a `*.const` assigns that constant; of a `local.get` or a
 * `local.tee`, whatever that copy held at the time, so a chain of copies of a
 * constant is followed in one run; of anything else, not a constant. At a merge
 * two different constants are not a constant. A parameter is not a constant at
 * entry; a declared local holds its zero, as wasm initialises it.
 *
 * This is PROPAGATION only. Nothing is evaluated: `x - 132 + 8` becoming
 * `x - 124` is folding, which stays with OptimizeInstructions, and evaluating
 * an expression to a constant is Precompute proper (open-work 23; owner,
 * 2026-10-06: "Constant propagation may go into item 2 now."). Upstream does the
 * propagation inside `precompute-propagate`; it has no pass that does only it,
 * so this one does not take an upstream name.
 *
 * Only numeric and `v128` locals are propagated. A reference local's value has
 * an identity and a type that may be narrower than the local's, so it is left
 * alone. A read in code no path reaches records no action in the CFG and is
 * left alone too. The sets that no read needs any more are CoalesceLocals'
 * and SimplifyLocals' to remove.
 *
 * Reference: `WebAssembly/binaryen/src/passes/Precompute.cpp` (`propagateLocals`)
 *
 * @license MIT
 */

import {
  type ConstExpr,
  type Expression,
  ExpressionKind,
  type Literal,
  makeF32ConstBits,
  makeF64ConstBits,
  makeI32Const,
  makeI64Const,
  makeV128Const,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { mapExpression } from '../ir/walk.ts';
import { type BasicBlock, buildCFG } from './cfg.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Replaces each `local.get` whose only reaching value is one constant with that constant. */
export class ConstantPropagationPass implements Pass {
  readonly name = 'ConstantPropagation';
  readonly description =
    'Replace each local.get whose only reaching value is one constant with that constant.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) _propagateFunction(fn);
  }
}

registerPass(ConstantPropagationPass);

// ---------------------------------------------------------------------------
// The lattice
// ---------------------------------------------------------------------------

/** Not a constant: two different constants met, or a value nothing here knows. */
const VARIES = Symbol('varies');
/** `undefined`: no path has reached this point yet. */
type Value = Literal | typeof VARIES | undefined;
type State = Value[];

function sameLiteral(a: Literal, b: Literal): boolean {
  if (a === b) return true;
  switch (a.type) {
    case ValType.I32:
    case ValType.I64:
      return a.type === b.type && a.value === (b as typeof a).value;
    case ValType.F32:
    case ValType.F64:
      // Bits, not numbers: two NaNs with different payloads are different
      // constants, and +0 is not -0.
      return a.type === b.type && a.bits === (b as typeof a).bits;
    case ValType.V128: {
      if (b.type !== ValType.V128) return false;
      for (let i = 0; i < 16; i++) if (a.bytes[i] !== b.bytes[i]) return false;
      return true;
    }
  }
}

function meet(a: Value, b: Value): Value {
  if (a === undefined) return b;
  if (b === undefined || a === b) return a;
  if (a === VARIES || b === VARIES) return VARIES;
  return sameLiteral(a, b) ? a : VARIES;
}

function sameValue(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === VARIES || b === VARIES) return false;
  return sameLiteral(a, b);
}

/** The zero a declared local of `type` starts with, or VARIES for a type not propagated. */
function zeroOf(type: unknown): Value {
  switch (type) {
    case ValType.I32:
      return { type: ValType.I32, value: 0 };
    case ValType.I64:
      return { type: ValType.I64, value: 0n };
    case ValType.F32:
      return { type: ValType.F32, bits: 0 };
    case ValType.F64:
      return { type: ValType.F64, bits: 0n };
    case ValType.V128:
      return { type: ValType.V128, bytes: new Uint8Array(16) };
    default:
      return VARIES;
  }
}

function isPropagated(type: unknown): boolean {
  return zeroOf(type) !== VARIES;
}

// ---------------------------------------------------------------------------
// Per-function implementation
// ---------------------------------------------------------------------------

function _propagateFunction(fn: WasmFunction): void {
  const numLocals = fn.locals.length;
  if (numLocals === 0) return;
  const numParams = fn.sig.params.length;
  const propagated = fn.locals.map((l) => isPropagated(l.type));
  if (!propagated.some((p) => p)) return;

  const cfg = buildCFG(fn.body, fn.bodyFrameLabel);
  const initial: State = fn.locals.map((l, i) => i < numParams ? VARIES : zeroOf(l.type));

  // What each read saw, and what each set / tee assigned, in the latest scan.
  const seen = new Map<Expression, Value>();
  const assigned = new Map<Expression, Value>();

  const valueOf = (e: Expression, type: unknown): Value => {
    switch (e.kind) {
      case ExpressionKind.Const:
        return e.value.type === type ? e.value : VARIES;
      case ExpressionKind.LocalGet:
        return seen.get(e) ?? VARIES;
      case ExpressionKind.LocalTee:
        return assigned.get(e) ?? VARIES;
      default:
        return VARIES;
    }
  };

  const scan = (b: BasicBlock, state: State): State => {
    const s = state.slice();
    for (const a of b.actions) {
      if (!propagated[a.index]) continue;
      if (a.kind === 'get') {
        seen.set(a.origin, s[a.index]);
      } else {
        const origin = a.origin as Extract<Expression, { kind: typeof ExpressionKind.LocalSet }>;
        const v = s[a.index] === undefined
          ? undefined // a path no one has reached yet assigns nothing yet
          : valueOf(origin.value, fn.locals[a.index]!.type);
        s[a.index] = v;
        assigned.set(a.origin, v);
      }
    }
    return s;
  };

  // Forward worklist to a fixed point. A block's out-state only rises in the
  // lattice (unreached → one constant → varies), so this terminates.
  const empty: State = new Array<Value>(numLocals).fill(undefined);
  const outs = cfg.blocks.map(() => empty);
  const inOf = (b: BasicBlock): State => {
    const s = b === cfg.entry ? initial.slice() : empty.slice();
    for (const p of b.in) {
      const o = outs[p.id]!;
      for (let i = 0; i < numLocals; i++) s[i] = meet(s[i], o[i]);
    }
    return s;
  };
  const queue: BasicBlock[] = [cfg.entry];
  const queued = new Set<number>([cfg.entry.id]);
  while (queue.length > 0) {
    const b = queue.shift()!;
    queued.delete(b.id);
    const out = scan(b, inOf(b));
    const prev = outs[b.id]!;
    let changed = false;
    for (let i = 0; i < numLocals && !changed; i++) changed = !sameValue(prev[i], out[i]);
    if (!changed && prev !== empty) continue;
    outs[b.id] = out;
    for (const s of b.out) {
      if (!queued.has(s.id)) {
        queue.push(s);
        queued.add(s.id);
      }
    }
  }

  // One last scan of every block with its converged in-state: what each read
  // sees at the fixed point.
  seen.clear();
  assigned.clear();
  for (const b of cfg.blocks) scan(b, inOf(b));

  const replace = new Map<Expression, Literal>();
  for (const [get, v] of seen) {
    if (v !== undefined && v !== VARIES) replace.set(get, v);
  }
  if (replace.size === 0) return;
  fn.body = mapExpression(fn.body, (e) => {
    const lit = replace.get(e);
    return lit === undefined ? e : makeConstOf(lit);
  });
}

/** A fresh `*.const` node for `lit` — never shared between sites. */
function makeConstOf(lit: Literal): ConstExpr {
  switch (lit.type) {
    case ValType.I32:
      return makeI32Const(lit.value);
    case ValType.I64:
      return makeI64Const(lit.value);
    case ValType.F32:
      return makeF32ConstBits(lit.bits);
    case ValType.F64:
      return makeF64ConstBits(lit.bits);
    case ValType.V128:
      return makeV128Const(lit.bytes.slice());
  }
}
