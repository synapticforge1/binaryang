/**
 * @module binaryen-ts/interp/table
 *
 * A table for the interpreter (open-work 23, E3c): bounds-checked element
 * access and the bulk operations, over reference values.
 *
 * A {@link TableCell} is shared, like a memory's or a global's cell: a module
 * importing a table holds the exporter's cell. Indices are unsigned (an `i32`
 * index `>>> 0`, an `i64` one `asUintN(64)`), and any element past the end is
 * `out of bounds table access`, raised by the interpreter from
 * {@link TableOutOfBounds}.
 *
 * `table.grow` returns −1 where the spec lets it fail — past the declared
 * maximum or the index space — and throws {@link TableTooLarge} (a Stop) past
 * what this process allocates, where answering −1 would be a result no engine
 * holding the table would give.
 *
 * @license MIT
 */

import type { Limits } from '../../wabt-ts/ir/ir.ts';

/** Elements beyond which growth is refused here (a Stop, not a −1). */
const ALLOCATION_LIMIT = 10_000_000n;

/** An access past the end of a table. */
export class TableOutOfBounds extends Error {}
/** The table would outgrow what this process allocates; the spec would not refuse it. */
export class TableTooLarge extends Error {}

/** One table's storage, shared by every module that imports it. `V` is the interpreter's value. */
export class TableCell<V> {
  elems: V[];
  readonly is64: boolean;
  private readonly max: bigint;

  constructor(limits: Limits, init: V) {
    this.is64 = limits.is64;
    const space = this.is64 ? 1n << 64n : 1n << 32n;
    this.max = limits.max !== undefined && limits.max < space ? limits.max : space - 1n;
    if (limits.initial > ALLOCATION_LIMIT) {
      throw new TableTooLarge(`table of ${limits.initial} elements`);
    }
    this.elems = new Array<V>(Number(limits.initial)).fill(init);
  }

  get size(): bigint {
    return BigInt(this.elems.length);
  }

  private at(i: bigint): number {
    if (i >= this.size) throw new TableOutOfBounds();
    return Number(i);
  }

  /** `[start, start + n)` within the table; `n` may be 0 at the end. */
  private range(start: bigint, n: bigint): [number, number] {
    if (start + n > this.size) throw new TableOutOfBounds();
    return [Number(start), Number(n)];
  }

  get(i: bigint): V {
    return this.elems[this.at(i)]!;
  }

  set(i: bigint, v: V): void {
    this.elems[this.at(i)] = v;
  }

  /** Grows by `delta` elements of `init`; the old size, or −1 where the spec allows refusal. */
  grow(delta: bigint, init: V): bigint {
    const old = this.size;
    const next = old + delta;
    if (next > this.max) return -1n;
    if (next > ALLOCATION_LIMIT) throw new TableTooLarge(`table of ${next} elements`);
    for (let i = 0n; i < delta; i++) this.elems.push(init);
    return old;
  }

  fill(dest: bigint, v: V, n: bigint): void {
    const [d, len] = this.range(dest, n);
    this.elems.fill(v, d, d + len);
  }

  /** `table.copy` within one table or between two; overlapping ranges copy as if through a buffer. */
  static copy<V>(to: TableCell<V>, dest: bigint, from: TableCell<V>, src: bigint, n: bigint): void {
    const [s, len] = from.range(src, n);
    const [d] = to.range(dest, n);
    const moved = from.elems.slice(s, s + len);
    for (let i = 0; i < len; i++) to.elems[d + i] = moved[i]!;
  }

  /** `table.init` / an active segment: `n` of `elems` from `src` to `dest`. */
  init(dest: bigint, elems: readonly V[], src: bigint, n: bigint): void {
    if (src + n > BigInt(elems.length)) throw new TableOutOfBounds();
    const [d, len] = this.range(dest, n);
    const s = Number(src);
    for (let i = 0; i < len; i++) this.elems[d + i] = elems[s + i]!;
  }
}
