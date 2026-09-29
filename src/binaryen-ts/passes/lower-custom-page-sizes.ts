// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/lower-custom-page-sizes
 *
 * Lowers memories with a CUSTOM PAGE SIZE (the custom-page-sizes proposal) to
 * ordinary 64 KiB-page memories, so an engine without the proposal — V8, today —
 * runs the module with the same behaviour. `wasm-opt --lower-custom-page-sizes`.
 *
 * Owner, 2026-09-29: "we want V8 to be able to run it. That is the whole point
 * of wasmtk, in that it runs everywhere." No upstream pass does this.
 *
 * ## How
 *
 * A memory of page size `ps < 65536` becomes a 64 KiB-page memory large enough
 * to hold it (limits rounded up), and a mutable global — `<memory>#pages` —
 * holds its size in CUSTOM pages. Then, for that memory:
 *
 * - `memory.size` reads the global;
 * - `memory.grow` refuses (−1) past the declared maximum or the address space,
 *   grows the underlying memory only when a 64 KiB boundary is crossed, and
 *   returns the old size in custom pages;
 * - every ACCESS — load, store, SIMD, atomics, `memory.fill` / `copy` / `init`
 *   — is bounds-checked against the TRUE byte size first, because the
 *   underlying memory is up to 64 KiB − 1 bytes larger and would not trap where
 *   the proposal does. Operands are evaluated once, in their order, before the
 *   check, so a trap happens where and when the original's would;
 * - an ACTIVE data segment that may end past the true size is checked by a
 *   start-time prologue, so instantiation still fails where it should;
 * - an explicit `(pagesize 65536)` is written as the default, which an engine
 *   without the proposal accepts.
 *
 * ## Linking
 *
 * An exported lowered memory also exports its page count as `<name>#pages`; an
 * imported one imports `<field>#pages` from the same module. Two lowered
 * modules link and agree on the size. A host that provides such a memory must
 * provide the global too — the size is not in the memory any more.
 *
 * ## Refused, loudly
 *
 * A SHARED custom-page memory (a plain global cannot make `grow` atomic across
 * threads), and any memory-touching instruction this pass does not know — a
 * silent pass-through would be an unchecked access.
 */

import {
  addressTypeOf,
  asRegion,
  BinaryOp,
  type Expression,
  ExpressionKind,
  makeBinary,
  makeBlock,
  makeCall,
  makeGlobalGet,
  makeGlobalSet,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLocalGet,
  makeLocalSet,
  makeMemoryGrow,
  makeMemorySize,
  makeUnary,
  makeUnreachable,
  typeOf,
  UnaryOp,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { None, ValType } from '../ir/types.ts';
import type { ValueType } from '../ir/gc-types.ts';
import { mapExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { naturalAlignForOpcode } from '../../wabt-ts/core/opcode.ts';
import { varIndex, varName } from '../../wabt-ts/ir/ir.ts';
import type { BlockResult, Limits, Var } from '../../wabt-ts/ir/ir.ts';

/**
 * An `i64.const` of a u64 quantity. The wire is SIGNED LEB128, so a value at or
 * above 2^63 — the address-space maximum of a 1-byte-page 64-bit memory is
 * 2^64 − 1 — is written as its two's complement; the comparisons that read it
 * are unsigned. 🔧 Written unsigned it failed: "s64 LEB128 out of range".
 */
function u64Const(v: bigint): Expression {
  return makeI64Const(BigInt.asIntN(64, v));
}

/** The suffix of the global that carries a lowered memory's size in custom pages. */
export const PAGES_SUFFIX = '#pages';

const LOG2_64K = 16;

/** One memory this pass lowers. */
interface Lowered {
  /** The page-count global's internal name. */
  pages: string;
  /** log2 of the custom page size. */
  log2: number;
  /** The memory's address type: the page count's and every address's. */
  addr: typeof ValType.I32 | typeof ValType.I64;
  /** Largest size in custom pages: the declared maximum, else the address space. */
  maxPages: bigint;
  /** Its initial size in bytes; `null` for an imported memory, known only at run time. */
  initialBytes: bigint | null;
}

/** Whether `limits` has a custom page size this pass must lower. */
function isCustom(limits: Limits): boolean {
  return limits.pageSizeLog2 !== undefined && limits.pageSizeLog2 < LOG2_64K;
}

/** The limits of the 64 KiB-page memory that holds `limits`' memory. */
function lowerLimits(limits: Limits): Limits {
  const log2 = limits.pageSizeLog2!;
  const toBig = (pages: bigint) => (pages << BigInt(log2)) + 0xffffn >> BigInt(LOG2_64K);
  // The engine's own ceiling for 64 KiB pages: 2^16 for a 32-bit memory, 2^48 for a 64-bit one.
  const ceiling = limits.is64 ? 1n << 48n : 1n << 16n;
  const out: Limits = {
    initial: toBig(limits.initial),
    isShared: limits.isShared,
    is64: limits.is64,
  };
  if (limits.max !== undefined) {
    const max = toBig(limits.max);
    out.max = max > ceiling ? ceiling : max;
  }
  return out;
}

/** The proposal's bound on a memory's size in pages: `2^bits / ps`, and never above `2^bits − 1`. */
function addressSpacePages(limits: Limits): bigint {
  const bits = limits.is64 ? 64n : 32n;
  const pages = (1n << bits) >> BigInt(limits.pageSizeLog2!);
  const most = (1n << bits) - 1n;
  return pages > most ? most : pages;
}

export class LowerCustomPageSizesPass implements Pass {
  readonly name = 'LowerCustomPageSizes';
  readonly description =
    'Lowers custom-page-size memories to 64 KiB pages with explicit bounds checks, for engines without the proposal.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    // The memory index space: imports first.
    const importedMemories = module.imports.filter((i) => i.kind === ExternalKind.Memory);
    const space = [
      ...importedMemories.map((i) =>
        (i as Extract<typeof i, { kind: ExternalKind.Memory }>).memory
      ),
      ...module.memories,
    ];
    const lowered = new Map<number, Lowered>();
    const taken = new Set([
      ...module.globals.map((g) => g.name),
      ...module.imports.flatMap((i) => i.kind === ExternalKind.Global ? [i.global.name] : []),
    ]);
    const fresh = (base: string) => {
      let name = base;
      for (let n = 1; taken.has(name); n++) name = `${base}.${n}`;
      taken.add(name);
      return name;
    };

    space.forEach((mem, index) => {
      const limits = mem.limits;
      if (limits.pageSizeLog2 === LOG2_64K) {
        // Explicitly the default: written as the default.
        delete limits.pageSizeLog2;
        return;
      }
      if (!isCustom(limits)) return;
      if (limits.isShared) {
        throw new Error(
          `lower-custom-page-sizes: memory ${mem.name} is SHARED; a page-count global cannot make memory.grow atomic`,
        );
      }
      const addr = addressTypeOf(limits);
      lowered.set(index, {
        pages: fresh(`${mem.name}${PAGES_SUFFIX}`),
        log2: limits.pageSizeLog2!,
        addr,
        maxPages: limits.max ?? addressSpacePages(limits),
        initialBytes: index < importedMemories.length
          ? null
          : limits.initial << BigInt(limits.pageSizeLog2!),
      });
    });
    if (lowered.size === 0) return;

    // The page-count globals: imported beside an imported memory, defined (and
    // exported beside an exported memory) otherwise.
    const pageConst = (addr: Lowered['addr'], v: bigint) =>
      addr === ValType.I64 ? u64Const(v) : makeI32Const(Number(BigInt.asIntN(32, v)));
    importedMemories.forEach((imp, index) => {
      const l = lowered.get(index);
      if (l === undefined) return;
      const i = imp as Extract<typeof imp, { kind: ExternalKind.Memory }>;
      module.imports.push({
        kind: ExternalKind.Global,
        module: i.module,
        field: `${i.field}${PAGES_SUFFIX}`,
        global: { name: l.pages, type: l.addr, mutable: true },
      });
    });
    module.memories.forEach((mem, k) => {
      const l = lowered.get(importedMemories.length + k);
      if (l === undefined) return;
      module.globals.push({
        name: l.pages,
        type: l.addr,
        mutable: true,
        init: asRegion(pageConst(l.addr, mem.limits.initial)),
      });
    });
    for (const e of [...module.exports]) {
      if (e.kind !== ExternalKind.Memory) continue;
      const l = lowered.get(memoryIndex(e.var, space));
      if (l === undefined) continue;
      module.exports.push({
        name: `${e.name}${PAGES_SUFFIX}`,
        kind: ExternalKind.Global,
        var: varName(l.pages),
      });
    }

    // Every function body.
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, (e) => rewrite(e, fn, lowered, space));
    }

    // Active data segments that could end in the slack the rounding added.
    addSegmentChecks(module, lowered, space);

    // Last: the memories themselves.
    for (const [index] of lowered) space[index]!.limits = lowerLimits(space[index]!.limits);
  }
}

registerPass(LowerCustomPageSizesPass);

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** A memory `Var`'s index in the memory space (imports first). */
function memoryIndex(v: Var, space: readonly { name: string }[]): number {
  if (v.kind === 'index') return v.value;
  const i = space.findIndex((m) => m.name === v.name);
  if (i < 0) throw new Error(`lower-custom-page-sizes: no memory ${v.name}`);
  return i;
}

/** A fresh local of `type` in `fn` (params come first in the one index space). */
function newLocal(fn: WasmFunction, type: ValueType): Var {
  fn.locals.push({ type });
  return varIndex(fn.locals.length - 1);
}

/** `e` (of `type`, i32 or i64) as an i64. */
function toI64(e: Expression, type: ValueType): Expression {
  return type === ValType.I64 ? e : makeUnary(UnaryOp.ExtendUI32, e);
}

/** The memory's true size in bytes, as an i64. */
function bytesOf(l: Lowered): Expression {
  const pages = toI64(makeGlobalGet(varName(l.pages), l.addr), l.addr);
  return l.log2 === 0 ? pages : makeBinary(BinaryOp.MulI64, pages, u64Const(1n << BigInt(l.log2)));
}

/** `if (end > bytes) unreachable`, `end` an i64 expression. */
function trapPast(end: Expression, l: Lowered): Expression {
  return makeIf(makeBinary(BinaryOp.GtUI64, end, bytesOf(l)), makeUnreachable());
}

/**
 * `node`, with its operands evaluated once, in order, into locals, then the
 * `checks` built from those locals, then `node` itself reading them.
 */
function guarded(
  node: Expression,
  fn: WasmFunction,
  operands: readonly string[],
  checks: (get: (field: string) => Expression) => Expression[],
): Expression {
  const record = node as unknown as Record<string, Expression>;
  const locals = new Map<string, { v: Var; type: ValueType }>();
  const sets: Expression[] = [];
  for (const field of operands) {
    const value = record[field]!;
    const type = typeOf(value) as ValueType;
    const v = newLocal(fn, type);
    locals.set(field, { v, type });
    sets.push(makeLocalSet(v, value));
  }
  const get = (field: string) => {
    const l = locals.get(field)!;
    return makeLocalGet(l.v, l.type);
  };
  const rebuilt = { ...record } as Record<string, Expression>;
  for (const field of operands) rebuilt[field] = get(field);
  const type = typeOf(node);
  return makeBlock(
    [...sets, ...checks(get), rebuilt as unknown as Expression],
    null,
    type as BlockResult,
  );
}

/** The access's end, `address + offset + width`, as an i64. */
function accessEnd(
  address: Expression,
  addr: ValueType,
  offset: bigint,
  width: number,
): Expression {
  return makeBinary(BinaryOp.AddI64, toI64(address, addr), u64Const(offset + BigInt(width)));
}

/** The kinds that read or write memory at `address + offset`, and their other operands in order. */
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

function rewrite(
  e: Expression,
  fn: WasmFunction,
  lowered: ReadonlyMap<number, Lowered>,
  space: readonly { name: string }[],
): Expression {
  const at = (v: Var) => lowered.get(memoryIndex(v, space));
  const operands = ACCESS[e.kind];
  if (operands !== undefined) {
    const node = e as unknown as { memidx: Var; offset: bigint; opcode?: number };
    const l = at(node.memidx);
    if (l === undefined) return e;
    // `memory.atomic.notify` carries no opcode; it touches an i32.
    const width = node.opcode === undefined ? 4 : naturalAlignForOpcode(node.opcode);
    return guarded(e, fn, operands, (get) => [
      trapPast(accessEnd(get('address'), l.addr, node.offset, width), l),
    ]);
  }
  switch (e.kind) {
    case ExpressionKind.MemorySize: {
      const l = at(e.memidx);
      return l === undefined ? e : makeGlobalGet(varName(l.pages), l.addr);
    }
    case ExpressionKind.MemoryGrow: {
      const l = at(e.memidx);
      return l === undefined ? e : grow(e.delta, e.memidx, l, fn);
    }
    case ExpressionKind.MemoryFill: {
      const l = at(e.memidx);
      if (l === undefined) return e;
      return guarded(e, fn, ['dest', 'value', 'size'], (get) => [
        trapPast(span(get('dest'), l.addr, get('size'), typeOf(e.size) as ValueType), l),
      ]);
    }
    case ExpressionKind.MemoryInit: {
      const l = at(e.memidx);
      if (l === undefined) return e;
      return guarded(e, fn, ['dest', 'source', 'size'], (get) => [
        trapPast(span(get('dest'), l.addr, get('size'), ValType.I32), l),
      ]);
    }
    case ExpressionKind.MemoryCopy: {
      const d = at(e.destMemidx);
      const s = at(e.srcMemidx);
      if (d === undefined && s === undefined) return e;
      const sizeType = typeOf(e.size) as ValueType;
      return guarded(e, fn, ['dest', 'source', 'size'], (get) => [
        ...(d === undefined ? [] : [trapPast(span(get('dest'), d.addr, get('size'), sizeType), d)]),
        ...(s === undefined
          ? []
          : [trapPast(span(get('source'), s.addr, get('size'), sizeType), s)]),
      ]);
    }
    default:
      if ('memidx' in e || 'destMemidx' in e) {
        const v = ('memidx' in e ? e.memidx : (e as { destMemidx: Var }).destMemidx) as Var;
        if (at(v) !== undefined) {
          throw new Error(
            `lower-custom-page-sizes: ${String(e.kind)} on a custom-page memory is not handled`,
          );
        }
      }
      return e;
  }
}

/** `start + length`, as an i64. */
function span(start: Expression, startType: ValueType, length: Expression, lengthType: ValueType) {
  return makeBinary(BinaryOp.AddI64, toI64(start, startType), toI64(length, lengthType));
}

/**
 * `memory.grow` in custom pages: −1 past the maximum (or on u64 wrap); else the
 * underlying memory grows to hold the new size when it must (−1 if it cannot),
 * the page count moves, and the OLD count is returned.
 */
function grow(delta: Expression, memidx: Var, l: Lowered, fn: WasmFunction): Expression {
  const i64 = ValType.I64;
  const oldV = newLocal(fn, i64);
  const newV = newLocal(fn, i64);
  const needV = newLocal(fn, i64);
  const get = (v: Var) => makeLocalGet(v, i64);
  const fail = l.addr === i64 ? u64Const(-1n) : makeI32Const(-1);
  const narrow = (x: Expression) => (l.addr === i64 ? x : makeUnary(UnaryOp.WrapI64, x));
  const perBig = BigInt(LOG2_64K - l.log2); // log2 of custom pages per 64 KiB page
  const underlyingSize = toI64(makeMemorySize(memidx, l.addr), l.addr);

  const refused = makeBinary(
    BinaryOp.OrI32,
    makeBinary(BinaryOp.GtUI64, get(newV), u64Const(l.maxPages)),
    makeBinary(BinaryOp.LtUI64, get(newV), get(oldV)), // wrapped past 2^64
  );
  // 64 KiB pages needed: ceil(new / 2^perBig).
  const needed = makeBinary(
    BinaryOp.ShrUI64,
    makeBinary(BinaryOp.AddI64, get(newV), u64Const((1n << perBig) - 1n)),
    u64Const(perBig),
  );
  const growUnderlying = makeBinary(
    l.addr === i64 ? BinaryOp.EqI64 : BinaryOp.EqI32,
    makeMemoryGrow(narrow(makeBinary(BinaryOp.SubI64, get(needV), underlyingSize)), memidx, l.addr),
    fail,
  );
  const commit = [
    makeGlobalSet(varName(l.pages), narrow(get(newV))),
    narrow(get(oldV)),
  ];
  return makeBlock(
    [
      makeLocalSet(oldV, toI64(makeGlobalGet(varName(l.pages), l.addr), l.addr)),
      makeLocalSet(newV, makeBinary(BinaryOp.AddI64, get(oldV), toI64(delta, l.addr))),
      makeIf(
        refused,
        fail,
        makeBlock(
          [
            makeLocalSet(needV, needed),
            makeIf(
              makeBinary(BinaryOp.GtUI64, get(needV), underlyingSize),
              makeIf(growUnderlying, fail, makeBlock(commit, null, l.addr), '', l.addr),
              makeBlock(commit, null, l.addr),
              '',
              l.addr,
            ),
          ],
          null,
          l.addr,
        ),
        '',
        l.addr,
      ),
    ],
    null,
    l.addr,
  );
}

// ---------------------------------------------------------------------------
// Active data segments
// ---------------------------------------------------------------------------

/**
 * Instantiation must fail when an active segment ends past a lowered memory's
 * true size. The underlying memory is larger, so a start-time prologue traps
 * instead — a trap during instantiation, as the original's is. Only segments
 * that COULD end in the slack get a check: a constant offset inside the true
 * size needs none.
 */
function addSegmentChecks(
  module: WasmModule,
  lowered: ReadonlyMap<number, Lowered>,
  space: readonly { name: string }[],
): void {
  const checks: Expression[] = [];
  for (const seg of module.dataSegments) {
    if (seg.offset === undefined) continue; // passive
    const l = lowered.get(memoryIndex(seg.memoryVar, space));
    if (l === undefined) continue;
    const offset = seg.offset.children.length === 1 ? seg.offset.children[0]! : null;
    const constant = offset?.kind === ExpressionKind.Const ? offset : null;
    if (constant !== null && l.initialBytes !== null && 'value' in constant.value) {
      const v = constant.value.value;
      const start = typeof v === 'bigint' ? BigInt.asUintN(64, v) : BigInt(v >>> 0);
      if (start + BigInt(seg.data.length) <= l.initialBytes) continue;
    }
    if (offset === null) {
      throw new Error(
        'lower-custom-page-sizes: a data segment offset of more than one instruction',
      );
    }
    checks.push(trapPast(
      makeBinary(BinaryOp.AddI64, toI64(offset, l.addr), u64Const(BigInt(seg.data.length))),
      l,
    ));
  }
  if (checks.length === 0) return;
  const name = `$lower-custom-page-sizes.check-segments`;
  const body: Expression[] = [...checks];
  if (module.start !== undefined) body.push(makeCall(module.start, [], None));
  module.functions.push({
    name,
    sig: { params: [], results: [] },
    locals: [],
    body: asRegion(makeBlock(body)),
  });
  module.start = varName(name);
}
