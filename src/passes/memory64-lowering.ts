// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/memory64-lowering
 *
 * Lowers 64-bit memories (memory64) to 32-bit ones, so an engine without memory64 —
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
import type { BlockResult, Var } from '../ir/ir.ts';

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

export class Memory64LoweringPass implements Pass {
  readonly name = 'Memory64Lowering';
  readonly description =
    'Lowers 64-bit memories to 32-bit ones with exact out-of-bounds traps, for engines without memory64.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    const imported = module.imports.filter((i) => i.kind === ExternalKind.Memory);
    const space = [
      ...imported.map((i) => (i as Extract<typeof i, { kind: ExternalKind.Memory }>).memory),
      ...module.memories,
    ];
    const lowered = new Set<number>();
    space.forEach((mem, index) => {
      if (!mem.limits.is64) return;
      if (mem.limits.initial > MAX_PAGES) {
        throw new Error(
          `memory64-lowering: memory ${
            mem.name || index
          } starts at ${mem.limits.initial} pages; a lowered memory holds at most ${MAX_PAGES}`,
        );
      }
      lowered.add(index);
    });
    if (lowered.size === 0) return;

    const at = (v: Var): boolean => lowered.has(memoryIndex(v, space));
    for (const fn of module.functions) {
      fn.body = mapExpression(fn.body, (e) => rewrite(e, fn, at));
    }

    for (const seg of module.dataSegments) {
      if (seg.offset === undefined || !at(seg.memoryVar)) continue; // passive, or a 32-bit memory
      const only = seg.offset.children.length === 1 ? seg.offset.children[0]! : null;
      if (only?.kind !== ExpressionKind.Const || !('value' in only.value)) {
        throw new Error(
          'memory64-lowering: an active data segment offset that is not one i64.const (a constant expression cannot wrap)',
        );
      }
      const v = BigInt.asUintN(64, BigInt(only.value.value as bigint | number));
      seg.offset.children[0] = makeI32Const(v > U32_MAX ? -1 : Number(BigInt.asIntN(32, v)));
    }

    // Last: the memories themselves.
    for (const index of lowered) {
      const limits = space[index]!.limits;
      limits.is64 = false;
      if (limits.max === undefined || limits.max > MAX_PAGES) limits.max = MAX_PAGES;
    }
  }
}

registerPass(Memory64LoweringPass);

/** A memory `Var`'s index in the memory space (imports first). */
function memoryIndex(v: Var, space: readonly { name: string }[]): number {
  if (v.kind === 'index') return v.value;
  const i = space.findIndex((m) => m.name === v.name);
  if (i < 0) throw new Error(`memory64-lowering: no memory ${v.name}`);
  return i;
}

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
 * ones (`wide`) has a high bit set, an out-of-bounds trap on `memidx`; then `node` reading the
 * locals, each wide one wrapped to i32.
 */
function guarded(
  node: Expression,
  fn: WasmFunction,
  operands: readonly string[],
  wide: ReadonlySet<string>,
  memidx: Var,
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
  const checks = anyHigh === null ? [] : [makeIf(anyHigh, oob(memidx))];
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

function rewrite(e: Expression, fn: WasmFunction, at: (v: Var) => boolean): Expression {
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
      return e;
  }
}
