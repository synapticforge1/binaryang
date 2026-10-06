// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/ir/effects
 *
 * What an expression does besides computing its value, and whether two pieces
 * of code may change places. Open-work 2, step 3 — the analysis the cleanup
 * passes share, as upstream's `ir/effects.h` is shared.
 *
 * **Fail-safe by construction:** a kind this file does not name is
 * {@link Effects.unknown}, which conflicts with everything. A new kind is
 * therefore never reordered until someone classifies it here; the mistake that
 * cannot happen is the silent one.
 *
 * Two traps never change places either: the trap a module reports (its kind
 * and message) is behaviour, which the behaviour gates compare.
 */

import { type Expression, ExpressionKind } from './expressions.ts';
import { visitChildren } from './walk.ts';
import { anyOpcodeName } from '../../wabt-ts/core/opcode.ts';
import type { Var } from '../../wabt-ts/ir/ir.ts';

/** What an expression does, other than yield its value. */
export interface Effects {
  /** Locals read / written, by index. */
  localsRead: Set<number>;
  localsWritten: Set<number>;
  /**
   * Globals read / written, by reference as written: `#3` for an index, the
   * name (`$g`) for a name — passes see globals by NAME where the module has
   * them. An index and a name are never proved different globals.
   */
  globalsRead: Set<string>;
  globalsWritten: Set<string>;
  readsMemory: boolean;
  writesMemory: boolean;
  readsTable: boolean;
  writesTable: boolean;
  /** GC heap: struct / array fields. */
  readsHeap: boolean;
  writesHeap: boolean;
  /** A call: may read and write any global state, trap, and throw. */
  calls: boolean;
  /** May trap. */
  trap: boolean;
  /** May transfer control: a branch, return, throw, or a loop (which may not end). */
  branches: boolean;
  /** Holds a `pop`, which must stay first in its catch. */
  pop: boolean;
  /** A kind not classified here: conflicts with everything. */
  unknown: boolean;
}

export function noEffects(): Effects {
  return {
    localsRead: new Set(),
    localsWritten: new Set(),
    globalsRead: new Set(),
    globalsWritten: new Set(),
    readsMemory: false,
    writesMemory: false,
    readsTable: false,
    writesTable: false,
    readsHeap: false,
    writesHeap: false,
    calls: false,
    trap: false,
    branches: false,
    pop: false,
    unknown: false,
  };
}

const _INT_DIVISION = /^i(32|64)\.(div|rem)_[su]$/;
const _TRAPPING_TRUNC = /^i(32|64)\.trunc_f(32|64)_[su]$/;

const _globalKey = (v: Var): string => (v.kind === 'index' ? `#${v.value}` : v.name);
function _globalRead(e: Effects, v: Var): void {
  e.globalsRead.add(_globalKey(v));
}
function _globalWrite(e: Effects, v: Var): void {
  e.globalsWritten.add(_globalKey(v));
}
function _localIndex(v: Var): number {
  if (v.kind !== 'index') throw new Error('effects: a local by name — passes see indices');
  return v.value;
}

/**
 * The effects of `expr` ITSELF, not of its children: what a walk in
 * evaluation order meets at this node, after its operands.
 */
export function shallowEffects(expr: Expression): Effects {
  const e = noEffects();
  switch (expr.kind) {
    case ExpressionKind.Nop:
    case ExpressionKind.Block:
    case ExpressionKind.Region:
    case ExpressionKind.If:
    case ExpressionKind.Const:
    case ExpressionKind.Select:
    case ExpressionKind.Drop:
    case ExpressionKind.RefNull:
    case ExpressionKind.RefIsNull:
    case ExpressionKind.RefFunc:
    case ExpressionKind.RefEq:
    case ExpressionKind.RefI31:
    case ExpressionKind.RefTest:
    case ExpressionKind.AnyConvertExtern:
    case ExpressionKind.ExternConvertAny:
    case ExpressionKind.StructNew:
    case ExpressionKind.ArrayNewFixed:
    case ExpressionKind.SIMDExtract:
    case ExpressionKind.SIMDReplace:
    case ExpressionKind.SIMDShuffle:
    case ExpressionKind.SIMDTernary:
      break;
    case ExpressionKind.Unary:
      if (_TRAPPING_TRUNC.test(anyOpcodeName(expr.opcode))) e.trap = true;
      break;
    case ExpressionKind.Binary:
      if (_INT_DIVISION.test(anyOpcodeName(expr.opcode))) e.trap = true;
      break;
    case ExpressionKind.LocalGet:
      e.localsRead.add(_localIndex(expr.var));
      break;
    case ExpressionKind.LocalSet:
    case ExpressionKind.LocalTee:
      e.localsWritten.add(_localIndex(expr.var));
      break;
    case ExpressionKind.GlobalGet:
      _globalRead(e, expr.var);
      break;
    case ExpressionKind.GlobalSet:
      _globalWrite(e, expr.var);
      break;
    case ExpressionKind.Load:
    case ExpressionKind.SIMDLoad:
      e.readsMemory = e.trap = true;
      break;
    case ExpressionKind.Store:
      e.writesMemory = e.trap = true;
      break;
    case ExpressionKind.SIMDLoadStoreLane:
      e.readsMemory = e.writesMemory = e.trap = true;
      break;
    case ExpressionKind.MemorySize:
      e.readsMemory = true;
      break;
    case ExpressionKind.MemoryGrow:
      e.readsMemory = e.writesMemory = true;
      break;
    case ExpressionKind.MemoryCopy:
    case ExpressionKind.MemoryFill:
    case ExpressionKind.MemoryInit:
      e.readsMemory = e.writesMemory = e.trap = true;
      break;
    case ExpressionKind.DataDrop:
      e.writesMemory = true;
      break;
    case ExpressionKind.AtomicLoad:
    case ExpressionKind.AtomicStore:
    case ExpressionKind.AtomicRMW:
    case ExpressionKind.AtomicCmpxchg:
    case ExpressionKind.AtomicWait:
    case ExpressionKind.AtomicNotify:
    case ExpressionKind.AtomicFence:
      // Ordering with every other memory access is their meaning.
      e.readsMemory = e.writesMemory = e.trap = true;
      break;
    case ExpressionKind.Call:
      e.calls = true;
      break;
    case ExpressionKind.CallIndirect:
      e.calls = e.trap = e.readsTable = true;
      break;
    case ExpressionKind.CallRef:
      e.calls = e.trap = true;
      break;
    case ExpressionKind.TableGet:
    case ExpressionKind.TableSize:
      e.readsTable = true;
      e.trap = expr.kind === ExpressionKind.TableGet;
      break;
    case ExpressionKind.TableSet:
    case ExpressionKind.TableFill:
    case ExpressionKind.TableCopy:
    case ExpressionKind.TableInit:
      e.readsTable = e.writesTable = e.trap = true;
      break;
    case ExpressionKind.TableGrow:
    case ExpressionKind.ElemDrop:
      e.readsTable = e.writesTable = true;
      break;
    case ExpressionKind.Unreachable:
      e.trap = true;
      break;
    case ExpressionKind.RefAs:
    case ExpressionKind.RefCast:
    case ExpressionKind.RefGetDesc:
    case ExpressionKind.I31Get:
    case ExpressionKind.ArrayLen:
    case ExpressionKind.ArrayNew:
      e.trap = true;
      break;
    case ExpressionKind.ArrayNewData:
      e.trap = e.readsMemory = true;
      break;
    case ExpressionKind.ArrayNewElem:
      e.trap = e.readsTable = true;
      break;
    case ExpressionKind.StructGet:
    case ExpressionKind.ArrayGet:
      e.readsHeap = e.trap = true;
      break;
    case ExpressionKind.StructSet:
    case ExpressionKind.ArraySet:
    case ExpressionKind.ArrayFill:
    case ExpressionKind.ArrayCopy:
      e.readsHeap = e.writesHeap = e.trap = true;
      break;
    case ExpressionKind.ArrayInitData:
      e.writesHeap = e.readsMemory = e.trap = true;
      break;
    case ExpressionKind.ArrayInitElem:
      e.writesHeap = e.readsTable = e.trap = true;
      break;
    case ExpressionKind.Break:
    case ExpressionKind.Switch:
    case ExpressionKind.Return:
    case ExpressionKind.BrOn:
    case ExpressionKind.Loop:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      e.branches = true;
      break;
    case ExpressionKind.Throw:
    case ExpressionKind.Rethrow:
      e.branches = true;
      break;
    case ExpressionKind.ThrowRef:
      e.branches = e.trap = true;
      break;
    case ExpressionKind.Pop:
      e.pop = true;
      break;
    default:
      e.unknown = true;
  }
  return e;
}

/** Adds `b` into `a`. */
export function mergeEffects(a: Effects, b: Effects): Effects {
  for (const i of b.localsRead) a.localsRead.add(i);
  for (const i of b.localsWritten) a.localsWritten.add(i);
  for (const i of b.globalsRead) a.globalsRead.add(i);
  for (const i of b.globalsWritten) a.globalsWritten.add(i);
  a.readsMemory ||= b.readsMemory;
  a.writesMemory ||= b.writesMemory;
  a.readsTable ||= b.readsTable;
  a.writesTable ||= b.writesTable;
  a.readsHeap ||= b.readsHeap;
  a.writesHeap ||= b.writesHeap;
  a.calls ||= b.calls;
  a.trap ||= b.trap;
  a.branches ||= b.branches;
  a.pop ||= b.pop;
  a.unknown ||= b.unknown;
  return a;
}

/** The effects of `expr` and everything under it. */
export function deepEffects(expr: Expression): Effects {
  const e = shallowEffects(expr);
  visitChildren(expr, (c) => mergeEffects(e, deepEffects(c)));
  return e;
}

/** Touches state a call may read or write. */
function _touchesGlobalState(e: Effects): boolean {
  return e.readsMemory || e.writesMemory || e.readsTable || e.writesTable || e.readsHeap ||
    e.writesHeap || e.globalsRead.size > 0 || e.globalsWritten.size > 0;
}

/** An effect visible after a trap ends the instance's run — so not a local write. */
function _observable(e: Effects): boolean {
  return e.writesMemory || e.writesTable || e.writesHeap || e.globalsWritten.size > 0 ||
    e.calls || e.branches;
}

/** Anything at all beyond computing a value. */
export function hasSideEffects(e: Effects): boolean {
  return _observable(e) || e.trap || e.localsWritten.size > 0 || e.unknown || e.pop;
}

const _meets = (a: Set<number>, b: Set<number>) => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

function _writesConflict(a: Effects, b: Effects): boolean {
  if (_meets(a.localsWritten, b.localsRead) || _meets(a.localsWritten, b.localsWritten)) {
    return true;
  }
  for (const w of a.globalsWritten) {
    for (const r of [...b.globalsRead, ...b.globalsWritten]) {
      // The same reference — or one by index and one by name, never proved apart.
      if (r === w || r.startsWith('#') !== w.startsWith('#')) return true;
    }
  }
  if (a.writesMemory && (b.readsMemory || b.writesMemory)) return true;
  if (a.writesTable && (b.readsTable || b.writesTable)) return true;
  if (a.writesHeap && (b.readsHeap || b.writesHeap)) return true;
  return false;
}

/**
 * True when code with effects `a` and code with effects `b` may NOT change
 * places: some order of the two is observable.
 */
export function invalidates(a: Effects, b: Effects): boolean {
  if (a.unknown || b.unknown) return true;
  if (a.pop || b.pop) return true;
  if ((a.branches && hasSideEffects(b)) || (b.branches && hasSideEffects(a))) return true;
  if (
    (a.calls && (b.calls || b.trap || _touchesGlobalState(b))) ||
    (b.calls && (a.trap || _touchesGlobalState(a)))
  ) return true;
  if (_writesConflict(a, b) || _writesConflict(b, a)) return true;
  // A trap moved past an observable effect would show it, or hide it; two
  // traps report different kinds.
  if ((a.trap && (_observable(b) || b.trap)) || (b.trap && _observable(a))) return true;
  return false;
}
