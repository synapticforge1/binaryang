/**
 * @module binaryen-ts/interp/memory
 *
 * A linear memory for the interpreter (open-work 23, E3b): bounds-checked
 * loads, stores and bulk operations, little-endian, floats as BITS (a NaN's
 * payload survives a store and a load, as the spec requires).
 *
 * A {@link MemoryCell} is shared, like a global's cell: a module importing a
 * memory holds the exporter's cell, so each sees the other's writes and growth.
 *
 * Addresses are unsigned — an `i32` address is read `>>> 0`, an `i64` one as
 * `asUintN(64)` — and the effective address is `address + offset` WITHOUT
 * wrapping, computed in `bigint` so a 64-bit memory's address never rounds.
 * An access with any byte past the end traps `out of bounds memory access`.
 *
 * `memory.grow` returns −1 where the spec lets it fail — past the declared
 * maximum, or past the address space — and STOPS (see `interpreter.ts`) where it
 * may not fail but this process cannot allocate that much: answering −1 there
 * would be a result no engine with the memory would give.
 *
 * @license MIT
 */

import type { Limits } from '../../wabt-ts/ir/ir.ts';

/** The bytes beyond which growth is refused here (a Stop, not a −1). */
const ALLOCATION_LIMIT = 1n << 30n;

/** An access past the end of memory. */
export class OutOfBounds extends Error {}
/** The memory would outgrow what this process allocates; the spec would not refuse it. */
export class TooLarge extends Error {}

/** One linear memory's storage, shared by every module that imports it. */
export class MemoryCell {
  bytes: Uint8Array;
  view: DataView;
  readonly pageSize: bigint;
  readonly is64: boolean;
  private readonly maxPages: bigint;

  constructor(limits: Limits) {
    this.pageSize = 1n << BigInt(limits.pageSizeLog2 ?? 16);
    this.is64 = limits.is64;
    // The address space bounds every memory, declared maximum or not.
    const space = this.is64 ? 1n << 64n : 1n << 32n;
    const spaceMax = space / this.pageSize;
    this.maxPages = limits.max !== undefined && limits.max < spaceMax ? limits.max : spaceMax;
    const size = limits.initial * this.pageSize;
    if (size > ALLOCATION_LIMIT) throw new TooLarge(`memory of ${limits.initial} pages`);
    this.bytes = new Uint8Array(Number(size));
    this.view = new DataView(this.bytes.buffer);
  }

  /** The current size in pages. */
  get pages(): bigint {
    return BigInt(this.bytes.length) / this.pageSize;
  }

  /** Grows by `delta` pages; the old size, or −1 where the spec allows refusal. */
  grow(delta: bigint): bigint {
    const old = this.pages;
    const next = old + delta;
    if (next > this.maxPages) return -1n;
    const size = next * this.pageSize;
    if (size > ALLOCATION_LIMIT) throw new TooLarge(`memory of ${next} pages`);
    if (delta === 0n) return old;
    const bytes = new Uint8Array(Number(size));
    bytes.set(this.bytes);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer);
    return old;
  }

  /** The byte offset of an access of `n` bytes at `address + offset`, or a throw. */
  at(address: bigint, offset: bigint, n: number): number {
    const ea = address + offset;
    if (ea + BigInt(n) > BigInt(this.bytes.length)) throw new OutOfBounds();
    return Number(ea);
  }

  /** Bounds of a bulk range `[start, start + n)`; `n` may be 0 at the end. */
  range(start: bigint, n: bigint): [number, number] {
    if (start + n > BigInt(this.bytes.length)) throw new OutOfBounds();
    return [Number(start), Number(n)];
  }

  fill(dest: bigint, value: number, n: bigint): void {
    const [d, len] = this.range(dest, n);
    this.bytes.fill(value & 0xff, d, d + len);
  }

  /**
   * `memory.copy` within one memory or between two. Overlapping ranges copy as
   * if through a buffer, as the spec requires — which `TypedArray.set` from the
   * same buffer already does (ECMA-262 clones the source first), so one call
   * serves both cases (a mutant special-casing `copyWithin` was equivalent).
   */
  static copy(to: MemoryCell, dest: bigint, from: MemoryCell, src: bigint, n: bigint): void {
    const [s, len] = from.range(src, n);
    const [d] = to.range(dest, n);
    to.bytes.set(from.bytes.subarray(s, s + len), d);
  }

  /** `memory.init` / an active segment: `n` bytes of `data` from `src` to `dest`. */
  init(dest: bigint, data: Uint8Array, src: bigint, n: bigint): void {
    if (src + n > BigInt(data.length)) throw new OutOfBounds();
    const [d, len] = this.range(dest, n);
    const s = Number(src);
    this.bytes.set(data.subarray(s, s + len), d);
  }
}
