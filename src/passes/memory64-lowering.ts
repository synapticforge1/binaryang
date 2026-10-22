// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/memory64-lowering
 *
 * Lowers 64-bit memories (memory64) and tables (table64) to 32-bit ones, so an engine without them —
 * JavaScriptCore (Safari, Bun) today: "Memory64 is not enabled" — runs the module with the SAME
 * behaviour. `wasm-opt --memory64-lowering`, upstream's flag (open-work 32).
 *
 * ## Sound, unlike upstream's (owner, 2026-10-22: "Trap, as the original")
 *
 * Upstream binaryen 133 lowers an address with a bare `i32.wrap_i64`, so above 2^32 a load READS
 * byte 0, a store OVERWRITES it, and `memory.grow` by 2^32 pages succeeds — measured
 * (cmem/run-everywhere.md § "Open-work 32"). Here a lowered module traps where the original does,
 * with the original's trap: out of bounds.
 *
 * ## How
 *
 * A lowered memory holds at most 65,535 pages — 4 GiB less one page (see {@link MAX_PAGES}) — so
 * any address, length or static offset of 2^32 or more is out of bounds in the original too. Then,
 * for each access to a lowered memory, its operands are evaluated once, in order, into locals; if
 * a 64-bit address or length has a high bit set, the access traps out of bounds (a 4-byte load at
 * the all-ones address, out of bounds for every 32-bit memory: the engine's own trap, as
 * `LowerCustomPageSizes`' `trapPast`); otherwise it runs on the wrapped operands, and the engine's
 * own bounds check is exact. A static offset of 2^32 or more traps after the operands, always.
 *
 * - `memory.size` → `i64.extend_i32_u (memory.size)`;
 * - `memory.grow d` → −1 when `d` has a high bit set, else `i64.extend_i32_s (memory.grow (wrap d))`
 *   (a 32-bit grow's −1 is −1 again; no old size reaches 2^31);
 * - `memory.fill` / `memory.copy` / `memory.init`, the SIMD lane accesses and the atomics: as an
 *   access, over each 64-bit operand;
 * - an active data segment's `i64.const` offset → `i32.const` (one of 2^32 or more → `-1`, so
 *   instantiation still fails as the original's does).
 *
 * ## Tables (table64), in the same pass — upstream's `--table64-lowering` is an alias
 *
 * A lowered table holds at most {@link MAX_ELEMENTS}. `call_indirect`'s index with a high bit set
 * becomes −1, which no lowered table holds, so the engine's OWN call_indirect trap fires (the spec
 * calls it "undefined element"; V8 and JavaScriptCore word it as for any index past the end);
 * `table.get` / `set` / `fill` / `copy` / `init` trap as a `table.get` at −1 ("out of bounds
 * table access"); `table.size` widens; `table.grow` returns −1 for a delta of 2^32 or more; an
 * active element segment's offset narrows as a data segment's. Upstream 133's version emits
 * invalid code for `table.get` / `table.set`, and wraps `call_indirect`'s index (measured).
 *
 * ## The interface changes, and is said to
 *
 * An imported or exported 64-bit memory becomes a 32-bit one: a host gives or takes a 32-bit
 * memory (`WebAssembly.Memory` with Number sizes), and another module expecting a 64-bit memory no
 * longer links. That is the point — an engine without memory64 has no 64-bit memory to give.
 *
 * ## Refused, loudly
 *
 * A memory whose INITIAL size exceeds {@link MAX_PAGES} (no 32-bit memory holds it); an active
 * segment whose offset is not one `i64.const` (a constant expression cannot wrap); any instruction
 * that touches a lowered memory and is not handled here — a silent pass-through would be an
 * unchecked 64-bit access.
 */

import {
  BinaryOp,
  type Expression,
  ExpressionKind,
  makeBinary,
  makeBlock,
  makeDrop,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLoad,
  makeLocalGet,
  makeLocalSet,
  makeMemoryGrow,
  makeMemorySize,
  makeSelect,
  makeTableGet,
  makeTableGrow,
  makeTableSize,
  makeUnary,
  makeUnreachable,
  typeOf,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { mapExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { ExternalKind } from '../core/binary.ts';
import { Opcode } from '../core/opcode.ts';
import { varIndex } from '../ir/ir.ts';
import type { BlockResult, Import, Limits, Table, Var } from '../ir/ir.ts';

/**
 * The most pages a lowered memory may hold: 65,535, 4 GiB less one page. At 65,536 (exactly 4 GiB)
 * a length of 2^32 would be in bounds and wrap to 0, so the high-bit rule would not be exact.
 * `memory.grow` may fail for implementation reasons (the spec says so), so a grow to the full
 * 4 GiB returning −1 is behaviour an engine may show; a memory that STARTS larger is refused.
 */
export const MAX_PAGES = 65_535n;

const U32_MAX = 0xffff_ffffn;

/** The kinds that read or write memory at `address + offset`, and their operands in order. */
const ACCESS: Partial<Record<string, readonly string[]>> = {
  [ExpressionKind.Load]: ['address'],
  [ExpressionKind.Store]: ['address', 'value'],
  [ExpressionKind.SIMDLoad]: ['address'],
  [ExpressionKind.SIMDLoadStoreLane]: ['address', 'vec'],
  [ExpressionKind.AtomicLoad]: ['address'],
  [ExpressionKind.AtomicStore]: ['address', 'value'],
  [ExpressionKind.AtomicRMW]: ['address', 'value'],
  [ExpressionKind.AtomicCmpxchg]: ['address', 'expected', 'replacement'],
  [ExpressionKind.AtomicWait]: ['address', 'expected', 'timeout'],
  [ExpressionKind.AtomicNotify]: ['address', 'count'],
};

/**
 * The most elements a lowered table may hold: 2^32 − 2. Then an index or length of 2^32 or more
 * is out of bounds in the original too, the index −1 (`0xffffffff`) is out of bounds for every
 * lowered table (the trap {@link oobTable} and `call_indirect`'s use), and a 32-bit `table.grow`
 * returning −1 can only mean it failed. A table that STARTS larger is refused.
 */
export const MAX_ELEMENTS = 0xffff_fffen;

/** What one lowered memory or table space knows: which entries are 64-bit, by index. */
interface Space {
  readonly lowered: ReadonlySet<number>;
  readonly at: (v: Var) => boolean;
  readonly index: (v: Var) => number;
}

/** The index space of memories or tables (imports first), and which entries are 64-bit. */
function lowerSpace<T extends { name: string; limits: Limits }>(
  what: 'memory' | 'table',
  items: readonly T[],
  max: bigint,
): Space & { items: readonly T[] } {
  const lowered = new Set<number>();
  items.forEach((item, index) => {
    if (!item.limits.is64) return;
    if (item.limits.initial > max) {
      throw new Error(
        `memory64-lowering: ${what} ${item.name || index} starts at ${item.limits.initial} ${
          what === 'memory' ? 'pages' : 'elements'
        }; a lowered ${what} holds at most ${max}`,
      );
    }
    lowered.add(index);
  });
  const indexOf = (v: Var): number => {
    if (v.kind === 'index') return v.value;
    const i = items.findIndex((m) => m.name === v.name);
    if (i < 0) throw new Error(`memory64-lowering: no ${what} ${v.name}`);
    return i;
  };
  return { items, lowered, at: (v) => lowered.has(indexOf(v)), index: indexOf };
}

/** An active segment's offset, one `i64.const`, as the `i32.const` of a lowered space. */
function narrowOffset(offset: { children: Expression[] }, what: 'data' | 'element'): void {
  const only = offset.children.length === 1 ? offset.children[0]! : null;
  if (only?.kind !== ExpressionKind.Const || !('value' in only.value)) {
    throw new Error(
      `memory64-lowering: an active ${what} segment offset that is not one i64.const (a constant expression cannot wrap)`,
    );
  }
  const v = BigInt.asUintN(64, BigInt(only.value.value as bigint | number));
  // 2^32 and up: −1, out of bounds for every lowered memory and table, so instantiation still fails.
  offset.children[0] = makeI32Const(v > U32_MAX ? -1 : Number(BigInt.asIntN(32, v)));
}

export class Memory64LoweringPass implements Pass {
  readonly name: string = 'Memory64Lowering';
  readonly description =
    'Lowers 64-bit memories and tables to 32-bit ones with exact out-of-bounds traps, for engines without memory64.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const importsOf = <K extends ExternalKind.Memory | ExternalKind.Table>(kind: K) =>
      module.imports.filter((i): i is Extract<Import, { kind: K }> => i.kind === kind);
    const mem = lowerSpace('memory', [
      ...importsOf(ExternalKind.Memory).map((i) => i.memory),
      ...module.memories,
    ], MAX_PAGES);
    const tab = lowerSpace('table', [
      ...importsOf(ExternalKind.Table).map((i) => i.table),
      ...module.tables,
    ], MAX_ELEMENTS);
    if (mem.lowered.size === 0 && tab.lowered.size === 0) return;

    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, (e) => rewrite(e, fn, mem, tab, tab.items));
    }
    for (const seg of module.dataSegments) {
      if (seg.offset !== undefined && mem.at(seg.memoryVar)) narrowOffset(seg.offset, 'data');
    }
    for (const seg of module.elements) {
      if (seg.offset !== undefined && tab.at(seg.tableVar)) narrowOffset(seg.offset, 'element');
    }

    // Last: the memories and tables themselves.
    for (const [space, max] of [[mem, MAX_PAGES], [tab, MAX_ELEMENTS]] as const) {
      for (const index of space.lowered) {
        const limits = space.items[index]!.limits;
        limits.is64 = false;
        if (limits.max === undefined || limits.max > max) limits.max = max;
      }
    }
  }
}

/** Upstream's alias: `--table64-lowering` is `--memory64-lowering`, memories and tables both. */
export class Table64LoweringPass extends Memory64LoweringPass {
  override readonly name = 'Table64Lowering';
}

registerPass(Memory64LoweringPass);
registerPass(Table64LoweringPass);

/** A fresh local of `type` in `fn` (params come first in the one index space). */
function newLocal(fn: WasmFunction, type: ValueType): Var {
  fn.locals.push({ type });
  return varIndex(fn.locals.length - 1);
}

/**
 * The engine's own out-of-bounds trap on `memidx`, which is 32-bit once lowered: a 4-byte load at
 * the all-ones address ends past 2^32, out of bounds for every 32-bit memory.
 */
function oob(memidx: Var): Expression {
  return makeDrop(makeLoad(Opcode.I32Load, 0n, 4, makeI32Const(-1), memidx));
}

/** `x` (an i64) has a bit set above the low 32. */
function high(x: Expression): Expression {
  return makeBinary(BinaryOp.GtUI64, x, makeI64Const(U32_MAX));
}

/**
 * `node` with its `operands` evaluated once, in order, into locals; then, when any of the 64-bit
 * ones (`wide`) has a high bit set, `trap` — an out-of-bounds access of the memory or table
 * `node` touches, as {@link oob} / {@link oobTable}; then `node` reading the locals, each wide one
 * wrapped to i32.
 */
function guarded(
  node: Expression,
  fn: WasmFunction,
  operands: readonly string[],
  wide: ReadonlySet<string>,
  trap: Var | (() => Expression),
): Expression {
  const record = node as unknown as Record<string, Expression>;
  const sets: Expression[] = [];
  const read = new Map<string, Expression>();
  let anyHigh: Expression | null = null;
  for (const field of operands) {
    const value = record[field]!;
    const type = typeOf(value) as ValueType;
    const v = newLocal(fn, type);
    sets.push(makeLocalSet(v, value));
    if (wide.has(field)) {
      const h = high(makeLocalGet(v, type));
      anyHigh = anyHigh === null ? h : makeBinary(BinaryOp.OrI32, anyHigh, h);
      read.set(field, makeUnary(UnaryOp.WrapI64, makeLocalGet(v, type)));
    } else read.set(field, makeLocalGet(v, type));
  }
  const rebuilt = { ...record } as Record<string, Expression>;
  for (const [field, e] of read) rebuilt[field] = e;
  const checks = anyHigh === null
    ? []
    : [makeIf(anyHigh, typeof trap === 'function' ? trap() : oob(trap))];
  return makeBlock(
    [...sets, ...checks, rebuilt as unknown as Expression],
    null,
    typeOf(node) as BlockResult,
  );
}

/** `node`'s operands evaluated in order and dropped, then an out-of-bounds trap: it can never run. */
function alwaysOob(node: Expression, operands: readonly string[], memidx: Var): Expression {
  const record = node as unknown as Record<string, Expression>;
  return makeBlock(
    [...operands.map((f) => makeDrop(record[f]!)), oob(memidx), makeUnreachable()],
    null,
    typeOf(node) as BlockResult,
  );
}

/** Whether `e` is an i64 operand (a 64-bit address or length of a lowered memory). */
const isI64 = (e: Expression): boolean => typeOf(e) === ValType.I64;

/**
 * The engine's own out-of-bounds TABLE trap on `table`, 32-bit once lowered: a `table.get` at −1,
 * which no lowered table reaches ({@link MAX_ELEMENTS}). The kind is "out of bounds table access",
 * as the original's `table.get` / `set` / `fill` / `copy` / `init` trap.
 */
function oobTable(table: Var, elemType: ValueType): Expression {
  return makeDrop(makeTableGet(table, makeI32Const(-1), elemType));
}

function rewrite(
  e: Expression,
  fn: WasmFunction,
  mem: Space,
  tab: Space,
  tables: readonly Table[],
): Expression {
  const at = mem.at;
  const elemType = (v: Var) => tables[tab.index(v)]!.elemType;
  switch (e.kind) {
    case ExpressionKind.CallIndirect: {
      if (!tab.at(e.table)) return e;
      // The arguments, then the index, into locals; an index with a high bit set becomes −1, which
      // no lowered table holds, so the ENGINE's call_indirect trap fires ("undefined element"),
      // the original's kind — not the table.get one.
      const sets: Expression[] = [];
      const operands = e.operands.map((op) => {
        const type = typeOf(op) as ValueType;
        const v = newLocal(fn, type);
        sets.push(makeLocalSet(v, op));
        return makeLocalGet(v, type);
      });
      const c = newLocal(fn, ValType.I64);
      sets.push(makeLocalSet(c, e.callee));
      const callee = makeSelect(
        makeI32Const(-1),
        makeUnary(UnaryOp.WrapI64, makeLocalGet(c, ValType.I64)),
        high(makeLocalGet(c, ValType.I64)),
        ValType.I32,
      );
      return makeBlock([...sets, { ...e, operands, callee }], null, typeOf(e) as BlockResult);
    }
    case ExpressionKind.TableGet:
      return tab.at(e.table)
        ? guarded(e, fn, ['index'], new Set(['index']), () => oobTable(e.table, elemType(e.table)))
        : e;
    case ExpressionKind.TableSet:
      return tab.at(e.table)
        ? guarded(
          e,
          fn,
          ['index', 'value'],
          new Set(['index']),
          () => oobTable(e.table, elemType(e.table)),
        )
        : e;
    case ExpressionKind.TableSize:
      return tab.at(e.table)
        ? makeUnary(UnaryOp.ExtendUI32, makeTableSize(e.table, ValType.I32))
        : e;
    case ExpressionKind.TableGrow: {
      if (!tab.at(e.table)) return e;
      // The value, then the delta; a delta with a high bit set cannot be met: −1. A 32-bit grow's
      // result is the old size (below 2^32 − 1, MAX_ELEMENTS) or −1, zero-extended or kept.
      const value = newLocal(fn, typeOf(e.value) as ValueType);
      const d = newLocal(fn, ValType.I64);
      const r = newLocal(fn, ValType.I32);
      const getD = () => makeLocalGet(d, ValType.I64);
      const getR = () => makeLocalGet(r, ValType.I32);
      return makeBlock(
        [
          makeLocalSet(value, e.value),
          makeLocalSet(d, e.delta),
          makeIf(
            high(getD()),
            makeI64Const(-1n),
            makeBlock(
              [
                makeLocalSet(
                  r,
                  makeTableGrow(
                    e.table,
                    makeLocalGet(value, typeOf(e.value) as ValueType),
                    makeUnary(UnaryOp.WrapI64, getD()),
                    ValType.I32,
                  ),
                ),
                makeSelect(
                  makeI64Const(-1n),
                  makeUnary(UnaryOp.ExtendUI32, getR()),
                  makeBinary(BinaryOp.EqI32, getR(), makeI32Const(-1)),
                  ValType.I64,
                ),
              ],
              null,
              ValType.I64,
            ),
            '',
            ValType.I64,
          ),
        ],
        null,
        ValType.I64,
      );
    }
    case ExpressionKind.TableFill:
      return tab.at(e.table)
        ? guarded(
          e,
          fn,
          ['dest', 'value', 'size'],
          new Set(['dest', 'size']),
          () => oobTable(e.table, elemType(e.table)),
        )
        : e;
    case ExpressionKind.TableInit:
      return tab.at(e.table)
        ? guarded(
          e,
          fn,
          ['dest', 'source', 'size'],
          new Set(['dest']),
          () => oobTable(e.table, elemType(e.table)),
        )
        : e;
    case ExpressionKind.TableCopy: {
      const d = tab.at(e.destTable), s = tab.at(e.sourceTable);
      if (!d && !s) return e;
      const wide = new Set<string>();
      if (d) wide.add('dest');
      if (s) wide.add('source');
      if (isI64(e.size)) wide.add('size');
      const t = d ? e.destTable : e.sourceTable;
      return guarded(e, fn, ['dest', 'source', 'size'], wide, () => oobTable(t, elemType(t)));
    }
  }
  const operands = ACCESS[e.kind];
  if (operands !== undefined) {
    const node = e as unknown as { memidx: Var; offset: bigint };
    if (!at(node.memidx)) return e;
    if (BigInt.asUintN(64, node.offset) > U32_MAX) return alwaysOob(e, operands, node.memidx);
    return guarded(e, fn, operands, new Set(['address']), node.memidx);
  }
  switch (e.kind) {
    case ExpressionKind.MemorySize:
      return at(e.memidx)
        ? makeUnary(UnaryOp.ExtendUI32, makeMemorySize(e.memidx, ValType.I32))
        : e;
    case ExpressionKind.MemoryGrow: {
      if (!at(e.memidx)) return e;
      const d = newLocal(fn, ValType.I64);
      const get = () => makeLocalGet(d, ValType.I64);
      return makeBlock(
        [
          makeLocalSet(d, e.delta),
          makeIf(
            high(get()),
            makeI64Const(-1n),
            makeUnary(
              UnaryOp.ExtendSI32,
              makeMemoryGrow(makeUnary(UnaryOp.WrapI64, get()), e.memidx, ValType.I32),
            ),
            '',
            ValType.I64,
          ),
        ],
        null,
        ValType.I64,
      );
    }
    case ExpressionKind.MemoryFill: {
      if (!at(e.memidx)) return e;
      return guarded(e, fn, ['dest', 'value', 'size'], new Set(['dest', 'size']), e.memidx);
    }
    case ExpressionKind.MemoryInit: {
      if (!at(e.memidx)) return e;
      return guarded(e, fn, ['dest', 'source', 'size'], new Set(['dest']), e.memidx);
    }
    case ExpressionKind.MemoryCopy: {
      const d = at(e.destMemidx), s = at(e.srcMemidx);
      if (!d && !s) return e;
      // The size is i64 only when both memories are 64-bit; each lowered side's own operand is.
      const wide = new Set<string>();
      if (d) wide.add('dest');
      if (s) wide.add('source');
      if (isI64(e.size)) wide.add('size');
      return guarded(e, fn, ['dest', 'source', 'size'], wide, d ? e.destMemidx : e.srcMemidx);
    }
    default:
      for (const key of ['memidx', 'destMemidx', 'srcMemidx']) {
        const v = (e as unknown as Record<string, Var | undefined>)[key];
        if (v !== undefined && typeof v === 'object' && 'kind' in v && at(v)) {
          throw new Error(`memory64-lowering: ${String(e.kind)} on a 64-bit memory is not handled`);
        }
      }
      for (const key of ['table', 'destTable', 'sourceTable']) {
        const v = (e as unknown as Record<string, Var | undefined>)[key];
        if (v !== undefined && typeof v === 'object' && 'kind' in v && tab.at(v)) {
          throw new Error(`memory64-lowering: ${String(e.kind)} on a 64-bit table is not handled`);
        }
      }
      return e;
  }
}
