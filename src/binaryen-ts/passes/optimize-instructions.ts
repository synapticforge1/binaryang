/**
 * @module binaryen-ts/passes/optimize-instructions
 *
 * OptimizeInstructions pass — peephole rewrites and algebraic simplifications.
 *
 * Two categories of transformations:
 *
 * **Algebraic identities** (applied when one operand is a constant):
 *   - `add(x, 0)` / `add(0, x)` → `x`
 *   - `sub(x, 0)` → `x`
 *   - `mul(x, 1)` / `mul(1, x)` → `x`
 *   - `mul(x, 0)` / `mul(0, x)` → `0` (only when the other operand is pure)
 *   - `and(x, -1)` / `and(-1, x)` → `x`
 *   - `and(x, 0)` / `and(0, x)` → `0` (pure operand only)
 *   - `or(x, 0)` / `or(0, x)` → `x`
 *   - `or(x, -1)` / `or(-1, x)` → `-1` (pure operand only)
 *   - `xor(x, 0)` / `xor(0, x)` → `x`
 *   - `shl/shr/rot(x, 0)` → `x`
 *   - `div(x, 1)` → `x`
 *   - `eq(x, 0)` → `eqz(x)` (i32 only)
 *
 * **Constant folding** (both operands are compile-time constants):
 *   - Integer binary ops: add, sub, mul, and, or, xor, shl, shr, rotl, rotr,
 *     eq, ne, lt, le, gt, ge (signed and unsigned variants).
 *   - Integer unary ops: clz, eqz, extend, wrap, sign-extend.
 *   - Division is excluded from constant folding (can trap on zero).
 *
 * **Shapes upstream's pass still found on our -Oz output** (open-work 2, step 3):
 *   - a store writes only its low bits: `i32.storeN(wrap x)` → `i64.storeN x`,
 *     `i64.storeN(extend x)` → `i32.storeN x`, a mask keeping those bits goes;
 *   - `i64.extend_i32_*(load)` → the extending `i64` load of the same sign;
 *   - a condition is true / false: `eqz(eqz x)` → `x`, `if (eqz c)` with an
 *     `else` swaps its arms, a `select` its operands when neither has an effect;
 *   - the constants an `add` / `sub` tree adds, gathered into one, through a
 *     `shl` / `mul` by a constant, spelled with the shorter constant.
 * NOT `load(add(p, c))` → `load offset=c p`: the add wraps at 32 bits and the
 * offset does not, so that needs to know low memory is unused (upstream's
 * `--low-memory-unused`), which nothing here does.
 *
 * Reference: `WebAssembly/binaryen/src/passes/OptimizeInstructions.cpp`
 *
 * @license MIT
 */

import {
  type BinaryExpr,
  BinaryOp,
  type Expression,
  ExpressionKind,
  type IfExpr,
  type Literal,
  makeBinary,
  makeF32ConstBits,
  makeI32Const,
  makeI64Const,
  makeLoad,
  type SelectExpr,
  type StoreExpr,
  type UnaryExpr,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapExpression } from '../ir/walk.ts';
import { anyOpcodeName, Opcode } from '../../wabt-ts/core/opcode.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Peephole rewrites: algebraic identities and integer constant folding. */
export class OptimizeInstructionsPass implements Pass {
  readonly name = 'OptimizeInstructions';
  readonly description =
    'Algebraic identities (identity element removal, strength reduction) and integer constant folding.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, _optimizeNode);
    }
    for (const global of module.globals) {
      if (global.init !== undefined) global.init = mapExpression(global.init, _optimizeNode);
    }
  }
}

registerPass(OptimizeInstructionsPass);

// ---------------------------------------------------------------------------
// Node-level optimizer (called bottom-up by mapExpression)
// ---------------------------------------------------------------------------

/**
 * Bottom-up algebraic-identity + constant-fold transform for a single
 * expression node.
 *
 * Exposed for callers that need to apply OptimizeInstructions semantics to a
 * single function body without running the whole module pass — e.g. the
 * `InliningOptimizing` pass cleans inlined call sites this way.
 */
export function optimizeNode(expr: Expression): Expression {
  return _optimizeNode(expr);
}

function _optimizeNode(expr: Expression): Expression {
  switch (expr.kind) {
    case ExpressionKind.Binary: {
      const r = _optimizeBinary(expr);
      return r.kind === ExpressionKind.Binary ? _optimizeAddedConstants(r) : r;
    }
    case ExpressionKind.Unary:
      return _optimizeUnary(expr);
    case ExpressionKind.Store:
      return _optimizeStore(expr);
    case ExpressionKind.If:
      return _optimizeIf(expr);
    case ExpressionKind.Break:
      if (expr.condition === undefined) return expr;
      return { ...expr, condition: _optimizeCondition(expr.condition) };
    case ExpressionKind.Select:
      return _optimizeSelect(expr);
  }
  return expr;
}

// ---------------------------------------------------------------------------
// Conditions (open-work 2, step 3)
// ---------------------------------------------------------------------------

const _isEqz32 = (e: Expression): e is UnaryExpr =>
  e.kind === ExpressionKind.Unary && e.opcode === UnaryOp.EqzI32;

/**
 * A value read only as true / false: `eqz(eqz(x))` is `x != 0`, which a
 * condition cannot tell from `x`.
 */
function _optimizeCondition(c: Expression): Expression {
  while (_isEqz32(c) && _isEqz32(c.value)) c = c.value.value;
  return c;
}

/** `if (eqz c) A else B` → `if c B else A`: one instruction fewer. */
function _optimizeIf(expr: IfExpr): Expression {
  const condition = _optimizeCondition(expr.condition);
  if (_isEqz32(condition) && expr.ifFalse !== null) {
    return { ...expr, condition: condition.value, ifTrue: expr.ifFalse, ifFalse: expr.ifTrue };
  }
  return condition === expr.condition ? expr : { ...expr, condition };
}

/**
 * `select(a, b, eqz c)` → `select(b, a, c)`. Both operands are evaluated,
 * always, in order — so only when swapping them cannot reorder an effect.
 */
function _optimizeSelect(expr: SelectExpr): Expression {
  const condition = _optimizeCondition(expr.condition);
  if (_isEqz32(condition) && _isPure(expr.val1) && _isPure(expr.val2)) {
    return { ...expr, condition: condition.value, val1: expr.val2, val2: expr.val1 };
  }
  return condition === expr.condition ? expr : { ...expr, condition };
}

// ---------------------------------------------------------------------------
// Memory: fold a conversion into the access (open-work 2, step 3)
// ---------------------------------------------------------------------------

/** The bits a store writes, for the plain integer stores. */
const _STORE_BITS = new Map<Opcode, number>([
  [Opcode.I32Store, 32],
  [Opcode.I32Store8, 8],
  [Opcode.I32Store16, 16],
  [Opcode.I64Store, 64],
  [Opcode.I64Store8, 8],
  [Opcode.I64Store16, 16],
  [Opcode.I64Store32, 32],
]);
/** The same-width store for the other integer type. */
const _STORE_I32_TO_I64 = new Map<Opcode, Opcode>([
  [Opcode.I32Store, Opcode.I64Store32],
  [Opcode.I32Store8, Opcode.I64Store8],
  [Opcode.I32Store16, Opcode.I64Store16],
]);
const _STORE_I64_TO_I32 = new Map<Opcode, Opcode>([
  [Opcode.I64Store32, Opcode.I32Store],
  [Opcode.I64Store8, Opcode.I32Store8],
  [Opcode.I64Store16, Opcode.I32Store16],
]);

/**
 * A store writes only its low bits, so what changes only the others goes:
 * - `i32.storeN(p, i32.wrap_i64(x))` → `i64.storeN(p, x)`;
 * - `i64.storeN(p, i64.extend_i32_*(x))` → `i32.storeN(p, x)`, N ≤ 32;
 * - `storeN(p, and(x, m))` → `storeN(p, x)` when `m` keeps all N low bits.
 * The alignment carries over: the widths, so the limits, are the same.
 */
function _optimizeStore(expr: StoreExpr): Expression {
  let { opcode, value } = expr;
  for (;;) {
    const bits = _STORE_BITS.get(opcode);
    if (bits === undefined) break;
    if (value.kind === ExpressionKind.Unary) {
      const to64 = _STORE_I32_TO_I64.get(opcode);
      if (value.opcode === UnaryOp.WrapI64 && to64 !== undefined) {
        opcode = to64;
        value = value.value;
        continue;
      }
      const to32 = _STORE_I64_TO_I32.get(opcode);
      if (
        (value.opcode === UnaryOp.ExtendUI32 || value.opcode === UnaryOp.ExtendSI32) &&
        to32 !== undefined
      ) {
        opcode = to32;
        value = value.value;
        continue;
      }
    }
    if (value.kind === ExpressionKind.Binary && value.right.kind === ExpressionKind.Const) {
      const m = value.right.value;
      const keepsLow = (value.opcode === BinaryOp.AndI32 && m.type === ValType.I32 &&
        bits < 32 && ((m.value & ((1 << bits) - 1)) === (1 << bits) - 1)) ||
        (value.opcode === BinaryOp.AndI64 && m.type === ValType.I64 && bits < 64 &&
          BigInt.asUintN(bits, m.value) === (1n << BigInt(bits)) - 1n);
      if (keepsLow) {
        value = value.left;
        continue;
      }
    }
    break;
  }
  return opcode === expr.opcode && value === expr.value ? expr : { ...expr, opcode, value };
}

/**
 * `i64.extend_i32_u(i32.loadN_u p)` → `i64.loadN_u p` (and `_s` with `_s`): the
 * load extends straight to 64 bits. Not a `_u` extend of an `_s` load, or the
 * reverse: those extend twice, differently.
 */
const _EXTEND_LOAD = new Map<string, Opcode>([
  [`${UnaryOp.ExtendUI32}:${Opcode.I32Load}`, Opcode.I64Load32U],
  [`${UnaryOp.ExtendSI32}:${Opcode.I32Load}`, Opcode.I64Load32S],
  [`${UnaryOp.ExtendUI32}:${Opcode.I32Load8U}`, Opcode.I64Load8U],
  [`${UnaryOp.ExtendUI32}:${Opcode.I32Load16U}`, Opcode.I64Load16U],
  [`${UnaryOp.ExtendSI32}:${Opcode.I32Load8S}`, Opcode.I64Load8S],
  [`${UnaryOp.ExtendSI32}:${Opcode.I32Load16S}`, Opcode.I64Load16S],
]);

// ---------------------------------------------------------------------------
// Added constants (open-work 2, step 3)
// ---------------------------------------------------------------------------

/** Bytes of a signed LEB128 constant. */
function _slebBytes(v: bigint): number {
  let n = 1;
  while (v < -64n || v > 63n) {
    v >>= 7n;
    n++;
  }
  return n;
}

/**
 * The constants an `add` / `sub` tree adds, gathered into one — all wrapping,
 * so exact:
 * - `(x + c1) + c2` → `x + (c1 + c2)` (and every `sub` spelling of it);
 * - `(c1 - x) + c2` → `(c1 + c2) - x`;
 * - `((x + c1) << k) + c2` → `(x << k) + ((c1 << k) + c2)`, and `* m` alike.
 * The result is `x + c` or `x - (-c)`, whichever constant encodes shorter — on
 * a tie the form it was — and `x` when the sum is 0.
 */
function _optimizeAddedConstants(expr: BinaryExpr): Expression {
  const w = _ADD_WIDTH.get(expr.opcode);
  if (w === undefined) return expr;
  // `c + x` → `x + c`: a constant has no effect to reorder.
  if (
    expr.opcode === w.add && expr.left.kind === ExpressionKind.Const &&
    expr.right.kind !== ExpressionKind.Const
  ) {
    expr = makeBinary(w.add, expr.right, expr.left);
  }
  if (expr.right.kind !== ExpressionKind.Const) return expr;
  const { add, sub, shl, mul, wrap, konst } = w;
  const c0 = w.read(expr.right.value);
  let c = expr.opcode === sub ? -c0 : c0;
  let x = expr.left;
  let changed = false;
  for (;;) {
    if (x.kind !== ExpressionKind.Binary) break;
    if ((x.opcode === add || x.opcode === sub) && x.right.kind === ExpressionKind.Const) {
      const k = w.read(x.right.value);
      c += x.opcode === add ? k : -k;
      x = x.left;
      changed = true;
      continue;
    }
    if (x.opcode === sub && x.left.kind === ExpressionKind.Const) {
      // (c1 - y) + c → (c1 + c) - y
      const r = makeBinary(sub, konst(wrap(w.read(x.left.value) + c)), x.right);
      return r;
    }
    if (
      (x.opcode === shl || x.opcode === mul) && x.right.kind === ExpressionKind.Const &&
      x.left.kind === ExpressionKind.Binary && x.left.right.kind === ExpressionKind.Const &&
      (x.left.opcode === add || x.left.opcode === sub)
    ) {
      const k = w.read(x.right.value);
      const inner = w.read(x.left.right.value) * (x.left.opcode === add ? 1n : -1n);
      c += x.opcode === shl ? inner << (k & w.mask) : inner * k;
      x = makeBinary(x.opcode, x.left.left, x.right);
      changed = true;
      continue;
    }
    break;
  }
  if (!changed) {
    // Only the choice of spelling is left to make: `x + c0` is `x - (-c0)`,
    // and `x - c0` is `x + (-c0)`.
    const alt = wrap(-c0);
    if (_slebBytes(alt) < _slebBytes(wrap(c0))) {
      return makeBinary(expr.opcode === add ? sub : add, x, konst(alt));
    }
    return expr;
  }
  c = wrap(c);
  if (c === 0n) return x;
  const neg = wrap(-c);
  return _slebBytes(neg) < _slebBytes(c)
    ? makeBinary(sub, x, konst(neg))
    : makeBinary(add, x, konst(c));
}

interface _Width {
  add: BinaryOp;
  sub: BinaryOp;
  shl: BinaryOp;
  mul: BinaryOp;
  mask: bigint;
  read(l: Literal): bigint;
  wrap(v: bigint): bigint;
  konst(v: bigint): Expression;
}
const _W32: _Width = {
  add: BinaryOp.AddI32,
  sub: BinaryOp.SubI32,
  shl: BinaryOp.ShlI32,
  mul: BinaryOp.MulI32,
  mask: 31n,
  read: (l) => BigInt(l.type === ValType.I32 ? l.value : 0),
  wrap: (v) => BigInt.asIntN(32, v),
  konst: (v) => makeI32Const(Number(BigInt.asIntN(32, v))),
};
const _W64: _Width = {
  add: BinaryOp.AddI64,
  sub: BinaryOp.SubI64,
  shl: BinaryOp.ShlI64,
  mul: BinaryOp.MulI64,
  mask: 63n,
  read: (l) => (l.type === ValType.I64 ? l.value : 0n),
  wrap: (v) => BigInt.asIntN(64, v),
  konst: (v) => makeI64Const(BigInt.asIntN(64, v)),
};
const _ADD_WIDTH = new Map<BinaryOp, _Width>([
  [BinaryOp.AddI32, _W32],
  [BinaryOp.SubI32, _W32],
  [BinaryOp.AddI64, _W64],
  [BinaryOp.SubI64, _W64],
]);

// ---------------------------------------------------------------------------
// Binary optimizations
// ---------------------------------------------------------------------------

function _optimizeBinary(
  expr: Extract<Expression, { kind: typeof ExpressionKind.Binary }>,
): Expression {
  const { opcode, left, right } = expr;

  // Constant folding: both operands are literal constants
  if (left.kind === ExpressionKind.Const && right.kind === ExpressionKind.Const) {
    const folded = _foldBinary(opcode, left.value, right.value);
    if (folded !== null) return folded;
  }

  // Algebraic identities with a constant on the right
  if (right.kind === ExpressionKind.Const) {
    const r = _simplifyRHS(opcode, left, right.value);
    if (r !== null) return r;
  }

  // Algebraic identities with a constant on the left (commutative ops)
  if (left.kind === ExpressionKind.Const) {
    const r = _simplifyLHS(opcode, left.value, right);
    if (r !== null) return r;
  }

  return expr;
}

/** True if `expr` has no observable side effects and can be dropped safely. */
function _isPure(expr: Expression): boolean {
  switch (expr.kind) {
    case ExpressionKind.Const:
    case ExpressionKind.Nop:
    case ExpressionKind.LocalGet:
    case ExpressionKind.GlobalGet:
      return true;
    case ExpressionKind.Binary: {
      const opcode = expr.opcode;
      // Integer division and remainder can trap on zero
      if (
        opcode === BinaryOp.DivSI32 || opcode === BinaryOp.DivUI32 ||
        opcode === BinaryOp.RemSI32 || opcode === BinaryOp.RemUI32 ||
        opcode === BinaryOp.DivSI64 || opcode === BinaryOp.DivUI64 ||
        opcode === BinaryOp.RemSI64 || opcode === BinaryOp.RemUI64
      ) return false;
      return _isPure(expr.left) && _isPure(expr.right);
    }
    case ExpressionKind.Unary: {
      // Non-saturating float-to-int truncations can trap
      // The operator is an opcode; dispatch below is on its NAME.
      const opcode = anyOpcodeName(expr.opcode);
      if (opcode.includes('trunc') && !opcode.includes('sat')) return false;
      return _isPure(expr.value);
    }
    default:
      return false;
  }
}

function _simplifyRHS(
  opcode: BinaryOp,
  left: Expression,
  rhs: Literal,
): Expression | null {
  if (rhs.type === ValType.I32) {
    const v = rhs.value;
    switch (opcode) {
      case BinaryOp.AddI32:
        if (v === 0) return left;
        break;
      case BinaryOp.SubI32:
        if (v === 0) return left;
        break;
      case BinaryOp.MulI32:
        if (v === 1) return left;
        if (v === 0 && _isPure(left)) return makeI32Const(0);
        break;
      case BinaryOp.DivSI32:
      case BinaryOp.DivUI32:
        if (v === 1) return left;
        break;
      case BinaryOp.AndI32:
        if (v === -1) return left;
        if (v === 0 && _isPure(left)) return makeI32Const(0);
        break;
      case BinaryOp.OrI32:
        if (v === 0) return left;
        if (v === -1 && _isPure(left)) return makeI32Const(-1);
        break;
      case BinaryOp.XorI32:
        if (v === 0) return left;
        break;
      case BinaryOp.ShlI32:
      case BinaryOp.ShrSI32:
      case BinaryOp.ShrUI32:
      case BinaryOp.RotlI32:
      case BinaryOp.RotrI32:
        if ((v & 31) === 0) return left;
        break;
      case BinaryOp.EqI32:
        if (v === 0) {
          return {
            kind: ExpressionKind.Unary,
            type: ValType.I32,
            opcode: UnaryOp.EqzI32,
            value: left,
          };
        }
        break;
    }
  }

  if (rhs.type === ValType.I64) {
    const v = rhs.value;
    switch (opcode) {
      case BinaryOp.AddI64:
        if (v === 0n) return left;
        break;
      case BinaryOp.SubI64:
        if (v === 0n) return left;
        break;
      case BinaryOp.MulI64:
        if (v === 1n) return left;
        if (v === 0n && _isPure(left)) return makeI64Const(0n);
        break;
      case BinaryOp.DivSI64:
      case BinaryOp.DivUI64:
        if (v === 1n) return left;
        break;
      case BinaryOp.AndI64:
        if (v === -1n) return left;
        if (v === 0n && _isPure(left)) return makeI64Const(0n);
        break;
      case BinaryOp.OrI64:
        if (v === 0n) return left;
        if (v === -1n && _isPure(left)) return makeI64Const(-1n);
        break;
      case BinaryOp.XorI64:
        if (v === 0n) return left;
        break;
      case BinaryOp.ShlI64:
      case BinaryOp.ShrSI64:
      case BinaryOp.ShrUI64:
      case BinaryOp.RotlI64:
      case BinaryOp.RotrI64:
        if ((v & 63n) === 0n) return left;
        break;
      case BinaryOp.EqI64:
        if (v === 0n) {
          return {
            kind: ExpressionKind.Unary,
            type: ValType.I32,
            opcode: UnaryOp.EqzI64,
            value: left,
          };
        }
        break;
    }
  }

  return null;
}

function _simplifyLHS(
  opcode: BinaryOp,
  lhs: Literal,
  right: Expression,
): Expression | null {
  if (lhs.type === ValType.I32) {
    const v = lhs.value;
    switch (opcode) {
      case BinaryOp.AddI32:
        if (v === 0) return right;
        break;
      case BinaryOp.MulI32:
        if (v === 1) return right;
        if (v === 0 && _isPure(right)) return makeI32Const(0);
        break;
      case BinaryOp.AndI32:
        if (v === -1) return right;
        if (v === 0 && _isPure(right)) return makeI32Const(0);
        break;
      case BinaryOp.OrI32:
        if (v === 0) return right;
        if (v === -1 && _isPure(right)) return makeI32Const(-1);
        break;
      case BinaryOp.XorI32:
        if (v === 0) return right;
        break;
    }
  }

  if (lhs.type === ValType.I64) {
    const v = lhs.value;
    switch (opcode) {
      case BinaryOp.AddI64:
        if (v === 0n) return right;
        break;
      case BinaryOp.MulI64:
        if (v === 1n) return right;
        if (v === 0n && _isPure(right)) return makeI64Const(0n);
        break;
      case BinaryOp.AndI64:
        if (v === -1n) return right;
        if (v === 0n && _isPure(right)) return makeI64Const(0n);
        break;
      case BinaryOp.OrI64:
        if (v === 0n) return right;
        if (v === -1n && _isPure(right)) return makeI64Const(-1n);
        break;
      case BinaryOp.XorI64:
        if (v === 0n) return right;
        break;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Unary optimizations
// ---------------------------------------------------------------------------

function _optimizeUnary(
  expr: Extract<Expression, { kind: typeof ExpressionKind.Unary }>,
): Expression {
  if (expr.value.kind === ExpressionKind.Const) {
    const folded = _foldUnary(expr.opcode, expr.value.value);
    if (folded !== null) return folded;
  }
  if (expr.value.kind === ExpressionKind.Load) {
    const load = expr.value;
    const to = _EXTEND_LOAD.get(`${expr.opcode}:${load.opcode}`);
    if (to !== undefined) return makeLoad(to, load.offset, load.align, load.address, load.memidx);
  }
  return expr;
}

// ---------------------------------------------------------------------------
// Constant folding — binary
// ---------------------------------------------------------------------------

function _foldBinary(
  opcode: BinaryOp,
  lhs: Literal,
  rhs: Literal,
): Expression | null {
  // i32 × i32
  if (lhs.type === ValType.I32 && rhs.type === ValType.I32) {
    const a = lhs.value;
    const b = rhs.value;
    switch (opcode) {
      case BinaryOp.AddI32:
        return makeI32Const((a + b) | 0);
      case BinaryOp.SubI32:
        return makeI32Const((a - b) | 0);
      case BinaryOp.MulI32:
        return makeI32Const(Math.imul(a, b));
      case BinaryOp.AndI32:
        return makeI32Const(a & b);
      case BinaryOp.OrI32:
        return makeI32Const(a | b);
      case BinaryOp.XorI32:
        return makeI32Const(a ^ b);
      case BinaryOp.ShlI32:
        return makeI32Const((a << (b & 31)) | 0);
      case BinaryOp.ShrSI32:
        return makeI32Const(a >> (b & 31));
      case BinaryOp.ShrUI32:
        return makeI32Const((a >>> (b & 31)) | 0);
      case BinaryOp.RotlI32: {
        const s = b & 31;
        return makeI32Const(s === 0 ? a : ((a << s) | (a >>> (32 - s))) | 0);
      }
      case BinaryOp.RotrI32: {
        const s = b & 31;
        return makeI32Const(s === 0 ? a : ((a >>> s) | (a << (32 - s))) | 0);
      }
      case BinaryOp.EqI32:
        return makeI32Const(a === b ? 1 : 0);
      case BinaryOp.NeI32:
        return makeI32Const(a !== b ? 1 : 0);
      case BinaryOp.LtSI32:
        return makeI32Const(a < b ? 1 : 0);
      case BinaryOp.LeSI32:
        return makeI32Const(a <= b ? 1 : 0);
      case BinaryOp.GtSI32:
        return makeI32Const(a > b ? 1 : 0);
      case BinaryOp.GeSI32:
        return makeI32Const(a >= b ? 1 : 0);
      case BinaryOp.LtUI32:
        return makeI32Const((a >>> 0) < (b >>> 0) ? 1 : 0);
      case BinaryOp.LeUI32:
        return makeI32Const((a >>> 0) <= (b >>> 0) ? 1 : 0);
      case BinaryOp.GtUI32:
        return makeI32Const((a >>> 0) > (b >>> 0) ? 1 : 0);
      case BinaryOp.GeUI32:
        return makeI32Const((a >>> 0) >= (b >>> 0) ? 1 : 0);
    }
  }

  // i64 × i64
  if (lhs.type === ValType.I64 && rhs.type === ValType.I64) {
    const a = lhs.value;
    const b = rhs.value;
    switch (opcode) {
      case BinaryOp.AddI64:
        return makeI64Const(BigInt.asIntN(64, a + b));
      case BinaryOp.SubI64:
        return makeI64Const(BigInt.asIntN(64, a - b));
      case BinaryOp.MulI64:
        return makeI64Const(BigInt.asIntN(64, a * b));
      case BinaryOp.AndI64:
        return makeI64Const(BigInt.asIntN(64, a & b));
      case BinaryOp.OrI64:
        return makeI64Const(BigInt.asIntN(64, a | b));
      case BinaryOp.XorI64:
        return makeI64Const(BigInt.asIntN(64, a ^ b));
      case BinaryOp.ShlI64:
        return makeI64Const(BigInt.asIntN(64, a << (b & 63n)));
      case BinaryOp.ShrSI64:
        return makeI64Const(a >> (b & 63n));
      case BinaryOp.ShrUI64:
        return makeI64Const(
          BigInt.asIntN(64, BigInt.asUintN(64, a) >> (b & 63n)),
        );
      case BinaryOp.RotlI64: {
        const s = b & 63n;
        if (s === 0n) return makeI64Const(a);
        const u = BigInt.asUintN(64, a);
        return makeI64Const(BigInt.asIntN(64, (u << s) | (u >> (64n - s))));
      }
      case BinaryOp.RotrI64: {
        const s = b & 63n;
        if (s === 0n) return makeI64Const(a);
        const u = BigInt.asUintN(64, a);
        return makeI64Const(BigInt.asIntN(64, (u >> s) | (u << (64n - s))));
      }
      // i64 comparisons return i32
      case BinaryOp.EqI64:
        return makeI32Const(a === b ? 1 : 0);
      case BinaryOp.NeI64:
        return makeI32Const(a !== b ? 1 : 0);
      case BinaryOp.LtSI64:
        return makeI32Const(a < b ? 1 : 0);
      case BinaryOp.LeSI64:
        return makeI32Const(a <= b ? 1 : 0);
      case BinaryOp.GtSI64:
        return makeI32Const(a > b ? 1 : 0);
      case BinaryOp.GeSI64:
        return makeI32Const(a >= b ? 1 : 0);
      case BinaryOp.LtUI64:
        return makeI32Const(BigInt.asUintN(64, a) < BigInt.asUintN(64, b) ? 1 : 0);
      case BinaryOp.LeUI64:
        return makeI32Const(BigInt.asUintN(64, a) <= BigInt.asUintN(64, b) ? 1 : 0);
      case BinaryOp.GtUI64:
        return makeI32Const(BigInt.asUintN(64, a) > BigInt.asUintN(64, b) ? 1 : 0);
      case BinaryOp.GeUI64:
        return makeI32Const(BigInt.asUintN(64, a) >= BigInt.asUintN(64, b) ? 1 : 0);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Constant folding — unary
// ---------------------------------------------------------------------------

function _foldUnary(opcode: UnaryOp, val: Literal): Expression | null {
  if (val.type === ValType.I32) {
    const v = val.value;
    switch (opcode) {
      case UnaryOp.ClzI32:
        return makeI32Const(Math.clz32(v));
      case UnaryOp.EqzI32:
        return makeI32Const(v === 0 ? 1 : 0);
      case UnaryOp.ExtendSI32:
        return makeI64Const(BigInt(v));
      case UnaryOp.ExtendUI32:
        return makeI64Const(BigInt(v >>> 0));
      case UnaryOp.ExtendS8I32:
        return makeI32Const((v << 24) >> 24);
      case UnaryOp.ExtendS16I32:
        return makeI32Const((v << 16) >> 16);
      case UnaryOp.ReinterpretI32:
        // `f32.reinterpret_i32` yields an F32. This built an i32 CONSTANT holding a
        // float, which -O2 then encoded as an invalid module (measured 2026-09-15).
        // The bits are the value: no conversion, so no NaN payload is lost either.
        return makeF32ConstBits(v >>> 0);
    }
  }

  if (val.type === ValType.I64) {
    const v = val.value;
    switch (opcode) {
      case UnaryOp.WrapI64:
        return makeI32Const(Number(BigInt.asIntN(32, v)));
      case UnaryOp.EqzI64:
        return makeI32Const(v === 0n ? 1 : 0);
      // 🔧 These went through `Number(v)`, which above 2^53 rounds away the
      // very bits they extend: `i64.extend8_s(0x100000000000007f)` folded to
      // the wrong constant (open-work 2, step 3).
      case UnaryOp.ExtendS8I64:
        return makeI64Const(BigInt.asIntN(8, v));
      case UnaryOp.ExtendS16I64:
        return makeI64Const(BigInt.asIntN(16, v));
      case UnaryOp.ExtendS32I64:
        return makeI64Const(BigInt.asIntN(64, BigInt(Number(BigInt.asIntN(32, v)))));
    }
  }

  if (val.type === ValType.F32) {
    if (opcode === UnaryOp.ReinterpretF32) {
      // Straight from the bits: going through a float LOST a signalling NaN's
      // payload, so `i32.reinterpret_f32` of one folded to the wrong integer.
      return makeI32Const(val.bits | 0);
    }
  }

  if (val.type === ValType.F64) {
    if (opcode === UnaryOp.ReinterpretF64) {
      return makeI64Const(BigInt.asIntN(64, val.bits));
    }
  }

  return null;
}
