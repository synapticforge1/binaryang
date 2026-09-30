/**
 * @module binaryen-ts/passes/coalesce-locals
 *
 * CoalesceLocals pass — reduces the number of distinct local variable slots.
 *
 * **Implementation: CFG-based liveness + greedy graph colouring.**
 *
 * For each function, the pass:
 *
 * 1. Builds a control-flow graph over the function body (handling `block`,
 *    `if`, `loop`, `br` / `br_if` / `br_table`, `return`, `unreachable`,
 *    `throw` / `try` / `try_table`).
 * 2. Runs backward-flow liveness to compute, per basic block, the set of
 *    locals live on entry (`start`) and on exit (`end`). This is a standard
 *    monotonically-growing fixed-point.
 * 3. Determines which `local.set` / `local.tee` instructions are *effective*
 *    (their value can be read by a later use) and which `local.get`s end a
 *    live range — both fall out of the backward scan over each block's
 *    actions starting from the block's `end`.
 * 4. Builds an interference graph by walking each block forward: at each
 *    effective set, all currently live locals (other than the one being
 *    written) interfere with it — except the local a COPY
 *    (`local.set x (local.get y)`) reads, which then holds the same value.
 *    Params interfere with each other pairwise; zero-initialised locals that
 *    are live at function entry interfere with every param.
 * 5. Greedily colours the interference graph — each non-param local takes a
 *    copy partner's slot if it fits, else the lowest slot, a PARAM's included,
 *    whose existing tenants do not interfere.
 * 6. Rewrites the body: renames local indices through the mapping, replaces
 *    ineffective `local.set` with `drop`, replaces ineffective `local.tee`
 *    with the bare value, and drops a copy onto its own slot. The
 *    `fn.locals` array is rebuilt to match the new slot count.
 *
 * Because liveness is computed across CFG edges, values that flow around
 * loop back-edges are kept live across the back-edge — so two locals whose
 * values are simultaneously live on different iterations are correctly
 * treated as interfering. This closes the residual gap from the previous
 * ordinal-based segment model.
 *
 * Reference: `WebAssembly/binaryen/src/passes/CoalesceLocals.cpp`,
 * `WebAssembly/binaryen/src/cfg/liveness-traversal.h`
 *
 * @license MIT
 */

import { asRegion, type Expression, ExpressionKind, makeDrop, makeNop } from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { mapExpression, walkExpression } from '../ir/walk.ts';
import { buildCFG, type CFG, computeLiveness, type LivenessAction } from './cfg.ts';
import { requireIndex, varIndex } from '../../wabt-ts/ir/ir.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/**
 * Eliminates dead local writes and merges non-interfering locals into shared
 * slots using a CFG-based liveness analysis.
 */
export class CoalesceLocalsPass implements Pass {
  readonly name = 'CoalesceLocals';
  readonly description =
    'Eliminates dead local writes and merges non-interfering locals into shared slots.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    for (const fn of module.functions) {
      _coalesceFunction(fn);
    }
  }
}

registerPass(CoalesceLocalsPass);

// ---------------------------------------------------------------------------
// Per-function implementation
// ---------------------------------------------------------------------------

function _coalesceFunction(fn: WasmFunction): void {
  const numLocals = fn.locals.length;
  if (numLocals === 0) return;
  const numParams = fn.sig.params.length;

  // 1. CFG + liveness ------------------------------------------------------
  const cfg = buildCFG(fn.body, fn.bodyFrameLabel);
  computeLiveness(cfg);

  // 2. Per-block effective-set / ends-live-range maps ----------------------
  // For each LocalSet/LocalTee origin, was its result ever used?
  // For each LocalGet origin, was it the last use within its block?
  const effectiveSet = new Set<Expression>();
  const endsLiveRange = new Set<Expression>();
  for (const b of cfg.blocks) {
    _classifyActions(b.actions, b.end, effectiveSet, endsLiveRange);
  }

  // 3. Interference matrix -------------------------------------------------
  // Upper-triangular: interferes(low, high) only.
  const interferes = new _InterferenceMatrix(numLocals);

  // Params interfere with each other so they can never be merged.
  for (let i = 0; i < numParams; i++) {
    for (let j = i + 1; j < numParams; j++) interferes.set(i, j);
  }
  // Locals live at function entry but not in the param range are reading the
  // wasm-spec zero-init value before any set. They interfere with all params
  // because their "value" is conceptually a set at function start.
  for (const x of cfg.entry.start) {
    if (x >= numParams) {
      for (let p = 0; p < numParams; p++) interferes.set(p, x);
    }
  }

  // Per-block forward scan to record interference at each effective set.
  for (const b of cfg.blocks) {
    _markBlockInterference(b, effectiveSet, endsLiveRange, interferes);
  }

  // 4. Greedy slot assignment ---------------------------------------------
  const mapping = new Array<number>(numLocals);
  for (let i = 0; i < numParams; i++) mapping[i] = i;

  // Slot → list of locals currently assigned to it.
  const slotMembers = new Map<number, number[]>();
  for (let i = 0; i < numParams; i++) slotMembers.set(i, [i]);

  // Copies between locals (`local.set x (local.get y)`), both directions: a
  // local prefers the slot of a local it is copied from or to, since sharing it
  // turns the copy into a copy onto itself, which the rewrite removes (as
  // upstream's copy weights do).
  const copyPartners = _copyPartners(cfg, effectiveSet, numLocals);

  const fits = (slot: number, local: number): boolean => {
    const members = slotMembers.get(slot)!;
    // Type must match (slots are typed); slots always have members.
    if (fn.locals[members[0]!]!.type !== fn.locals[local]!.type) return false;
    return members.every((m) => !interferes.get(m, local));
  };

  let nextSlot = numParams;
  for (let local = numParams; local < numLocals; local++) {
    let assigned = -1;
    // A copy partner's slot first — a PARAM's included — then the lowest slot
    // that fits. 🔧 Open-work 2, step 1: the search started past the params, so
    // a variable could never take a param's slot; the copy an inline leaves
    // (`local.set 1 (local.get 0)`, param 0 not read again) could not go.
    for (const partner of copyPartners[local]!) {
      if (partner >= local) continue; // not yet placed
      const slot = mapping[partner]!;
      if (fits(slot, local)) {
        assigned = slot;
        break;
      }
    }
    for (let slot = 0; assigned === -1 && slot < nextSlot; slot++) {
      if (fits(slot, local)) assigned = slot;
    }
    if (assigned === -1) {
      assigned = nextSlot++;
      slotMembers.set(assigned, []);
    }
    mapping[local] = assigned;
    slotMembers.get(assigned)!.push(local);
  }

  // 5. Rewrite the body ----------------------------------------------------
  const mappingChanged = mapping.some((v, i) => v !== i);
  const hasIneffective = _hasAnyIneffective(cfg, effectiveSet);

  if (mappingChanged || hasIneffective) {
    fn.body = asRegion(_rewriteBody(fn.body, mapping, effectiveSet));
  }

  // 6. Rebuild fn.locals ---------------------------------------------------
  if (mappingChanged) {
    const newLocals = new Array(nextSlot);
    for (let i = 0; i < numParams; i++) newLocals[i] = fn.locals[i];
    for (let i = numParams; i < numLocals; i++) {
      // A variable sharing a PARAM's slot leaves the param's entry as it is.
      if (mapping[i]! >= numParams) newLocals[mapping[i]!] = fn.locals[i]!;
    }
    // Every slot from numParams to nextSlot-1 was allocated by the loop above,
    // so a gap is an invariant violation in the colouring. Filling it with an
    // arbitrary other local's type (the old `fn.locals[numParams] ?? fn.locals[0]`)
    // would hand the slot the WRONG TYPE and encode a different program —
    // exactly the guessed-default shape the robustness contract forbids. A
    // "can't happen" that silently miscompiles when it does happen is worse
    // than a throw.
    for (let i = numParams; i < nextSlot; i++) {
      if (!newLocals[i]) {
        throw new Error(
          `CoalesceLocals: slot ${i} of ${nextSlot} was never assigned a local in ` +
            `function ${fn.name} — interference colouring left a gap`,
        );
      }
    }
    fn.locals = newLocals;
  }
}

// ---------------------------------------------------------------------------
// Backward classification: effective sets + ends-live-range gets
// ---------------------------------------------------------------------------

function _classifyActions(
  actions: LivenessAction[],
  liveAtEnd: ReadonlySet<number>,
  effectiveSet: Set<Expression>,
  endsLiveRange: Set<Expression>,
): void {
  const live = new Set(liveAtEnd);
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!; // bounded by the loop header
    if (a.kind === 'get') {
      if (!live.has(a.index)) {
        endsLiveRange.add(a.origin);
        live.add(a.index);
      }
    } else {
      // set / tee
      if (live.has(a.index)) {
        effectiveSet.add(a.origin);
        live.delete(a.index);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Forward interference marking for one block
// ---------------------------------------------------------------------------

function _markBlockInterference(
  block: { actions: LivenessAction[]; start: ReadonlySet<number> },
  effectiveSet: ReadonlySet<Expression>,
  endsLiveRange: ReadonlySet<Expression>,
  interferes: _InterferenceMatrix,
): void {
  const live = new Set(block.start);
  for (const a of block.actions) {
    if (a.kind === 'get') {
      if (endsLiveRange.has(a.origin)) live.delete(a.index);
      continue;
    }
    // set
    if (!effectiveSet.has(a.origin)) continue;
    // A COPY (`local.set x (local.get y)`) leaves x and y holding one value, so
    // it does not make them interfere; a later write to either, while the other
    // is live, does (as upstream's liveness does).
    const source = _copySource(a.origin);
    for (const other of live) {
      if (other !== a.index && other !== source) interferes.set(other, a.index);
    }
    live.add(a.index);
  }
}

/** The local a `local.set` / `local.tee` copies — its value is a bare `local.get` — or -1. */
function _copySource(set: Expression): number {
  if (set.kind !== ExpressionKind.LocalSet && set.kind !== ExpressionKind.LocalTee) return -1;
  const v = set.value;
  return v.kind === ExpressionKind.LocalGet ? requireIndex(v.var, 'local index') : -1;
}

/** For each local, the locals an EFFECTIVE copy connects it to, in either direction. */
function _copyPartners(
  cfg: CFG,
  effectiveSet: ReadonlySet<Expression>,
  numLocals: number,
): number[][] {
  const partners = Array.from({ length: numLocals }, () => new Set<number>());
  for (const b of cfg.blocks) {
    for (const a of b.actions) {
      if (a.kind !== 'set' || !effectiveSet.has(a.origin)) continue;
      const source = _copySource(a.origin);
      if (source < 0 || source === a.index || source >= numLocals) continue;
      partners[a.index]!.add(source);
      partners[source]!.add(a.index);
    }
  }
  return partners.map((s) => [...s].sort((x, y) => x - y));
}

// ---------------------------------------------------------------------------
// Upper-triangular interference matrix
// ---------------------------------------------------------------------------

class _InterferenceMatrix {
  private readonly n: number;
  private readonly bits: Uint8Array;
  constructor(n: number) {
    this.n = n;
    // n*(n-1)/2 entries; store as a flat byte array.
    this.bits = new Uint8Array(Math.max(0, (n * (n - 1)) >> 1));
  }
  private indexOf(low: number, high: number): number {
    // low < high; pair (i, j) → i * n - i*(i+1)/2 + (j - i - 1)
    return low * this.n - ((low * (low + 1)) >> 1) + (high - low - 1);
  }
  set(a: number, b: number): void {
    if (a === b) return;
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    if (low < 0 || high >= this.n) return;
    this.bits[this.indexOf(low, high)] = 1;
  }
  get(a: number, b: number): boolean {
    if (a === b) return false;
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    if (low < 0 || high >= this.n) return false;
    return this.bits[this.indexOf(low, high)] === 1;
  }
}

// ---------------------------------------------------------------------------
// Body rewrite — rename indices + replace ineffective sets/tees
// ---------------------------------------------------------------------------

function _hasAnyIneffective(cfg: CFG, effectiveSet: ReadonlySet<Expression>): boolean {
  for (const b of cfg.blocks) {
    for (const a of b.actions) {
      if (a.kind === 'set' && !effectiveSet.has(a.origin)) return true;
    }
  }
  return false;
}

/** Symbol marker stamped on each ineffective `LocalSet` / `LocalTee` so the
 *  rewrite phase below can identify them after `mapExpression`'s bottom-up walk
 *  has spread-copied their parents. See `_rewriteBody`. */
const _INEFFECTIVE = Symbol('binaryen-ts:CoalesceLocals:ineffective');

function _markIneffective(e: Expression): void {
  (e as unknown as { [k: symbol]: unknown })[_INEFFECTIVE] = true;
}

function _isIneffective(e: Expression): boolean {
  return (e as unknown as { [k: symbol]: unknown })[_INEFFECTIVE] === true;
}

function _rewriteBody(
  expr: Expression,
  mapping: number[],
  effectiveSet: ReadonlySet<Expression>,
): Expression {
  // PRE-PASS: mark each ineffective `LocalSet` / `LocalTee` on the ORIGINAL
  // node with a `Symbol` property.
  //
  // Why we can't just check `effectiveSet.has(e)` in the rewrite callback:
  // `mapExpression` is bottom-up and `_mapChildren` UNCONDITIONALLY spreads
  // (`{ ...expr, value: mapped }`) — so by the time the callback sees a parent
  // `LocalSet`, any descendant `LocalGet` that got renamed has already caused
  // every ancestor on the path to be rebuilt as a fresh object. The `e` the
  // callback receives is therefore a brand-new spread copy with a different
  // identity from the one `cfg.blocks[*].actions[*].origin` recorded, so
  // `effectiveSet.has(e)` was guaranteed to return `false` — and every set
  // came out as a drop. (Including loop-carried writes: `_fib`'s accumulator
  // updates were all turned into drops, so the function always returned 0.)
  //
  // Object spread copies own-enumerable properties INCLUDING symbol-keyed ones,
  // so a marker stamped on the original here survives every rebuild on the way
  // up — the rewrite callback can read it from the spread copy.
  walkExpression(expr, (e) => {
    if (e.kind === ExpressionKind.LocalSet || e.kind === ExpressionKind.LocalTee) {
      if (!effectiveSet.has(e)) _markIneffective(e);
    }
  });

  /** Whether `value` (already renamed) reads the very slot being written. */
  const readsSlot = (value: Expression, slot: number) =>
    value.kind === ExpressionKind.LocalGet && requireIndex(value.var, 'local index') === slot;

  return mapExpression(expr, (e) => {
    if (e.kind === ExpressionKind.LocalSet) {
      // `e.value` here is already the post-rewrite (renamed) value subtree.
      if (_isIneffective(e)) return makeDrop(e.value);
      const cur = requireIndex(e.var, 'local index');
      const slot = mapping[cur] ?? cur;
      // A copy onto ITSELF once coalesced does nothing (upstream drops it too).
      if (readsSlot(e.value, slot)) return makeNop();
      if (slot !== cur) return { ...e, var: varIndex(slot) };
      return e;
    }
    if (e.kind === ExpressionKind.LocalTee) {
      // Tee both writes and pushes the value. If the write is ineffective,
      // the tee degrades to just the (already-rewritten) value.
      if (_isIneffective(e)) return e.value;
      const cur = requireIndex(e.var, 'local index');
      const slot = mapping[cur] ?? cur;
      // A tee of the slot it writes is just that read.
      if (readsSlot(e.value, slot)) return e.value;
      if (slot !== cur) return { ...e, var: varIndex(slot) };
      return e;
    }
    if (e.kind === ExpressionKind.LocalGet) {
      const cur = requireIndex(e.var, 'local index');
      const slot = mapping[cur];
      if (slot !== undefined && slot !== cur) return { ...e, var: varIndex(slot) };
    }
    return e;
  });
}
