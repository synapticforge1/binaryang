// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * As-written metadata held BESIDE the tree rather than inside its nodes.
 *
 * The project has two goals that pull in opposite directions: round-trip
 * fidelity through the wabt-ts half, and optimization through the binaryen-ts
 * half. They are not two shapes competing for one tree — they are two phases,
 * and they are never both meaningful for the same module, because once a pass
 * runs there is no original left to be faithful to.
 *
 * So: one tree, two sets of operations over it, and everything that exists only
 * to reproduce the input exactly lives here instead of on the node. wabt-ts's
 * operations read and write this table; binaryen-ts's passes never touch it and
 * drop it wholesale.
 *
 * ## Why the key is an id and not the node itself
 *
 * The obvious key is node identity — a `WeakMap<Expr, Entry>` — and it gives
 * exactly the semantics wanted: replace a subtree and its entries go with it.
 *
 * ⚠️ **It does not survive this codebase.** wabt-ts's IR is immutable, so its
 * passes rebuild nodes by spread rather than mutating them (`resolveNames` does
 * it in 75 places, `applyNames` in 25). A spread mints a new object and so a new
 * identity, even when the pass is semantically identity-PRESERVING — resolving
 * `$x` to `0` is the same instruction in the same place, landing in a different
 * object. Measured on a five-instruction module, 2 of 8 entries survived
 * `resolveNames`.
 *
 * 🔑 An identity-keyed table would be emptied by the very pipeline that needs
 * it, and silently: entries vanish, the writer falls back to derived values, and
 * the output stays valid while quietly ceasing to be faithful.
 *
 * An opaque {@link NodeId} carried on the node fixes it without touching any of
 * those 100 rebuild sites, because a spread copies the id along with everything
 * else. A pass that CONSTRUCTS a replacement node gets no id and therefore no
 * entry, which is the original intent arriving from the other direction.
 *
 * ⚠️ **The guarantee is weaker than pure identity, deliberately.** A pass that
 * rewrites a node by spread keeps the id, and so keeps an entry that may now be
 * stale. That is tolerable only because optimization drops the whole table; if
 * that ever stops being true, this key stops being sufficient.
 *
 * Degradation is safe: a missing entry means the writer derives the value, which
 * is what it does today for everything. That is what lets the as-written set
 * move across one family at a time, each step proven by the byte baseline.
 */

import type { ValueType, Var } from './ir.ts';

/**
 * An opaque handle identifying one expression node across immutable rebuilds.
 *
 * Branded so it cannot be confused with the many other numbers in this IR —
 * indices, opcodes, offsets — none of which it is.
 */
export type NodeId = number & { readonly __brand: 'NodeId' };

/**
 * What was written, for one node, where the tree alone would not say.
 *
 * Every field is optional: a node records only the aspects whose written form
 * is not recoverable from the tree. An absent field means "derive it", which is
 * the behaviour that predates this table.
 */
export interface FidelityEntry {
  /**
   * `(select (result i32) …)` as written, versus a bare `select`.
   *
   * Not decoration — the two are different opcodes (`0x1c` and `0x1b`) — but the
   * tree does not carry the distinction, because a typed select's result is
   * derivable from its operands. Only the *choice to write it* is not.
   */
  readonly selectResultType?: readonly ValueType[];

  /**
   * The explicit `(type $t)` on a call, where the signature was also written
   * inline. Both spellings mean the same signature; only one is what was typed.
   */
  readonly typeUse?: Var;
}

/**
 * As-written metadata for one module, keyed by {@link NodeId}.
 *
 * Deliberately a plain `Map` and not a `WeakMap`: the entries are keyed by a
 * value, not an object, so there is nothing for a weak reference to observe.
 * The table's lifetime is the module's.
 */
export class FidelityTable {
  #next = 1;
  readonly #entries = new Map<NodeId, FidelityEntry>();

  /** A fresh id, unique within this table. */
  mint(): NodeId {
    return this.#next++ as NodeId;
  }

  /** Record `entry` for `id`, merging into anything already recorded. */
  set(id: NodeId, entry: FidelityEntry): void {
    const prior = this.#entries.get(id);
    this.#entries.set(id, prior ? { ...prior, ...entry } : entry);
  }

  /**
   * Mint an id, record `entry` against it, and return it for the node to carry.
   *
   * The common shape at a construction site, where the node does not exist yet.
   */
  record(entry: FidelityEntry): NodeId {
    const id = this.mint();
    this.set(id, entry);
    return id;
  }

  /** What was written for `id`, or `undefined` — meaning "derive it". */
  get(id: NodeId | undefined): FidelityEntry | undefined {
    return id === undefined ? undefined : this.#entries.get(id);
  }

  /** How many nodes carry as-written data. Diagnostics and tests. */
  get size(): number {
    return this.#entries.size;
  }
}
