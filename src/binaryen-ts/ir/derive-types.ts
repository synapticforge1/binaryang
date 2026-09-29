// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/ir/derive-types
 *
 * S6 step 5 item 6 (M8d): every expression node's `type`, derived over a whole
 * module — what binaryen-ts's passes dispatch on, and what a tree read by
 * wabt-ts does not carry. The bridge derived it by REBUILDING every node through
 * the factories; this sets it in place, by the factories' own rules:
 *
 * - where a factory derives the type from the node itself (an opcode, its
 *   children), the factory is CALLED and its `type` taken, so the rule lives in
 *   one place;
 * - where a factory takes the type from its caller (a local's, a global's, a
 *   callee's results, a GC type's), it comes from the module, as binaryen-ts's
 *   decoder supplies it — the decoder, not the bridge, where they differ: the
 *   bridge coarsened a typed-reference local to its abstract type, typed every
 *   `pop` `i32` and `ref.i31` nullable.
 *
 * A block-type carrier's `type` is DECLARED and required on the node, so it is
 * read, not derived.
 *
 * **`pop`.** wabt-ts's `pop` stands for an operand its parser found no
 * instruction for: an extra result of a multi-value call, a value an earlier
 * instruction left, a carrier's parameter, a caught exception's values. The
 * encoder writes it as nothing, so the value in its slot is exactly what the
 * wasm stack holds when its parent is emitted — and that is how it is typed
 * here: each region's value stack is simulated in emission order. Where the
 * stack is empty and the code is reachable there is no such value, and the
 * module is refused rather than a type guessed; in unreachable code the stack
 * is polymorphic and the `pop` is `unreachable`.
 */

import type * as W from '../../wabt-ts/ir/ir.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { anyOpcodeName } from '../../wabt-ts/core/opcode.ts';
import {
  addressTypeOf,
  type Expression,
  ExpressionKind,
  makeAtomicCmpxchg,
  makeAtomicLoad,
  makeAtomicRmw,
  makeBinary,
  makeBreak,
  makeCallIndirect,
  makeExternConvert,
  makeLoad,
  makeMemoryGrow,
  makeMemorySize,
  makeSelect,
  makeSIMDExtract,
  makeSIMDLoadStoreLane,
  makeTableGrow,
  makeTableSize,
  makeUnary,
  refNullType,
  typeOf,
} from './expressions.ts';
import { AbstractHeapType, isRefType, Packed, type ValueType } from './gc-types.ts';
import { heapAbstract, heapExact } from '../../wabt-ts/ir/ir.ts';
import { None, type Type, Unreachable, ValType } from './types.ts';
import { BrOnOp } from '../../wabt-ts/ir/ir.ts';
import { visitChildren } from './walk.ts';
import type { WasmModule } from './module.ts';

type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** The types a result denotes, one per stack slot. Shared with the spill step. */
export function slots(t: Type): ValueType[] {
  if (t === None || t === Unreachable) return [];
  return Array.isArray(t) ? [...t] : [t];
}

/** A result list as one `Type`: none, the one value, or the tuple. */
function resultOf(results: readonly ValueType[]): Type {
  if (results.length === 0) return None;
  return results.length === 1 ? results[0]! : [...results];
}

/** An entity looked up by a reference, by index or by name. */
class Space<T extends { name: string }> {
  private readonly byName = new Map<string, T>();
  constructor(private readonly items: readonly T[], private readonly what: string) {
    for (const it of items) {
      if (it.name !== '' && !this.byName.has(it.name)) this.byName.set(it.name, it);
    }
  }
  get(v: W.Var): T {
    const it = v.kind === 'index' ? this.items[v.value] : this.byName.get(v.name);
    if (it === undefined) throw new Error(`derive-types: no ${this.what} ${JSON.stringify(v)}`);
    return it;
  }
}

/**
 * Where a stack value came from: the node that produced it, or `'entry'` for one
 * the region was ENTERED with (a carrier's parameter, a caught payload). Absent
 * where a polymorphic stack had nothing to give. Recorded for
 * {@link PopSources} — the spill step needs to know which node a `pop` will find,
 * and this simulation is the only place that knows.
 */
type Origin = Expression | 'entry';

/** What each `pop` takes: its producer, `'entry'`, or `undefined` for a phantom. */
export type PopSources = Map<Expression, Origin | undefined>;

/** One region's value stack, in emission order. */
class Stack {
  private readonly values: { type: ValueType; from: Origin | undefined }[];
  /** After an `unreachable`-typed instruction the stack is polymorphic. */
  private dead = false;
  constructor(seed: readonly ValueType[]) {
    this.values = seed.map((type) => ({ type, from: 'entry' as const }));
  }
  /**
   * The top `n` values, deepest first, WITHOUT removing them — `unreachable`
   * for each one a dead stack lacks. A live stack that lacks one is refused.
   */
  peek(n: number, what: string): Type[] {
    const got: Type[] = this.values.slice(Math.max(0, this.values.length - n)).map((v) => v.type);
    this.require(n, got.length, what);
    return [...new Array<Type>(n - got.length).fill(Unreachable), ...got];
  }
  /** Where the top `n` values came from, deepest first, padded like {@link peek}. */
  peekFrom(n: number): (Origin | undefined)[] {
    const got = this.values.slice(Math.max(0, this.values.length - n)).map((v) => v.from);
    return [...new Array<Origin | undefined>(n - got.length).fill(undefined), ...got];
  }
  /** Remove the top `n` values. */
  drop(n: number, what: string): void {
    this.require(n, this.values.length, what);
    this.values.length = Math.max(0, this.values.length - n);
  }
  private require(n: number, held: number, what: string): void {
    if (held < n && !this.dead) {
      throw new Error(`derive-types: ${what} consumes ${n} value(s) and the stack holds ${held}`);
    }
  }
  push(t: Type, from?: Origin): void {
    if (t === Unreachable) {
      this.values.length = 0;
      this.dead = true;
    } else for (const type of slots(t)) this.values.push({ type, from });
  }
}

/** Derives every node's type in one function (or one constant expression). */
class Deriver {
  /** The branch targets in scope, innermost last: each label and the values a branch to it carries. */
  private readonly labels: { name: string; types: readonly ValueType[] }[];

  constructor(
    private readonly m: Module,
    private readonly locals: readonly W.Local[],
    /** The function's results — what a branch to the frame carries. */
    results: readonly ValueType[],
    frameLabel: string,
    /** Where each `pop` takes its value from, when a caller asked to record it. */
    private readonly popSources?: PopSources,
  ) {
    this.labels = [{ name: frameLabel, types: results }];
  }

  /** The values a branch to `v` carries. */
  private carried(v: W.Var): readonly ValueType[] {
    const l = v.kind === 'index'
      ? this.labels[this.labels.length - 1 - v.value]
      : this.labels.findLast((x) => x.name === v.name);
    if (l === undefined) throw new Error(`derive-types: no label ${JSON.stringify(v)}`);
    return l.types;
  }

  /** A region's instructions, on a stack seeded with `seed`; the region's type by the factories' rule. */
  region(children: readonly Expression[], seed: readonly ValueType[]): Type {
    const stack = new Stack(seed);
    for (const c of children) this.emit(c, stack);
    const last = children[children.length - 1];
    return last === undefined ? None : typeOf(last);
  }

  private regionNode(r: W.RegionExpr, seed: readonly ValueType[]): void {
    (r as Mut<W.RegionExpr>).type = this.region(r.children, seed);
  }

  /**
   * Emit `e` onto `stack`: its operands first, then it consumes its values
   * (typing each `pop` from the stack), then its result is pushed.
   *
   * The values its operands CLAIM: one per `pop`, one per operand that
   * produces a value, none for one that produces nothing — the parser gives a
   * `br` every instruction left on its stack, a void `call` included. The
   * parser pads placeholders into the DEEPEST positions, so the `pop`s take the
   * deepest of those values, in order. What the instruction REMOVES is its real
   * arity: a branch's target's, `return`'s results; otherwise what its
   * operands claim.
   */
  private emit(e: Expression, stack: Stack): void {
    if (e.kind === ExpressionKind.Pop) return; // written as nothing
    const operands = this.operandsOf(e);
    for (const o of operands) this.emit(o, stack);
    const pops = operands.filter((o) => o.kind === ExpressionKind.Pop);
    const claimed = operands.reduce(
      (n, o) => n + (o.kind === ExpressionKind.Pop || slots(typeOf(o)).length > 0 ? 1 : 0),
      0,
    );
    const what = `${e.kind}${e.loc === undefined ? '' : ` at line ${e.loc.line}`}`;
    const values = stack.peek(claimed, what);
    // The same slots, by origin: what each `pop` will actually find at run time.
    // Only the spill step asks (`popSources`), and only when it is going to
    // rewrite; typing does not depend on it.
    const sources = this.popSources === undefined ? undefined : stack.peekFrom(claimed);
    pops.forEach((o, i) => {
      (o as Mut<typeof o>).type = values[i]!;
      if (sources !== undefined) this.popSources!.set(o, sources[i]);
    });
    stack.drop(this.consumes(e, claimed), what);
    const params = carrierParams(e);
    if (params !== undefined) this.carrierBody(e, params.types);
    (e as Mut<typeof e>).type = this.typeOfNode(e);
    this.leave(e, stack);
  }

  /**
   * What `e` leaves on the stack — its type, except where wasm's rule and the
   * tree can disagree. A `br_if` falls through with exactly its target's
   * values, whether or not the tree holds them as its operands: a front end
   * that does not know a target's arity reads `(br_if 0 (br_if 0 …) …)` as
   * two siblings. wabt-ts's binary reader did until post-M8 fixes 4 and 10,
   * the WAT parser until fix 5 (and still does where a label cannot be
   * resolved). Both still leave a `br_if` carrying TWO or more values a
   * statement, as upstream folds it, so what consumes them finds `pop`s this
   * rule types. A `br_on_*` falls
   * through with its carried values AND — except `br_on_non_null` — the ref;
   * its node type is the ref's alone, as the decoder gives it.
   */
  private leave(e: Expression, stack: Stack): void {
    // A `br_if`'s node type IS its target's values (see `typeOfNode`).
    if (e.kind === ExpressionKind.BrOn) {
      for (const v of e.values) stack.push(typeOf(v), e);
      if (e.opcode !== BrOnOp.NonNull) stack.push(typeOf(e), e);
    } else stack.push(typeOf(e), e);
  }

  /**
   * How many values `e` removes from the stack, given what its operands
   * claim: a `br_if`, its target's values and the condition, whether or not
   * the tree holds the values. (An unconditional transfer — `br`,
   * `br_table`, `return` — leaves the stack polymorphic, so what it removes
   * is never observed.)
   */
  private consumes(e: Expression, claimed: number): number {
    return e.kind === ExpressionKind.Break && e.condition !== undefined
      ? this.carried(e.target).length + 1
      : claimed;
  }

  /** A node's operands: its direct children other than its regions (a carrier's entry values, an if's condition). */
  private operandsOf(e: Expression): Expression[] {
    switch (e.kind) {
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        return [...(e.params?.values ?? [])];
      case ExpressionKind.If:
        return [...(e.params?.values ?? []), e.condition];
      // A branch's carried values are pushed BEFORE its condition / index —
      // wasm's evaluation order. `visitChildren` gives the reverse (a recorded
      // open item: fixing it there may move optimizer bytes), which put a
      // condition's value on this stack first; a `pop` nested in a carried
      // value then took it. Found by W10b: the spec's INVALID `br.6` — a
      // `br` needing a value it lacks, nested as a `br_if`'s value — was
      // typed from the `br_if`'s condition instead of refused.
      case ExpressionKind.Break:
        return e.condition === undefined ? [...e.values] : [...e.values, e.condition];
      case ExpressionKind.Switch:
        return [...e.values, e.condition];
      case ExpressionKind.Region:
        throw new Error('derive-types: a region reached an operand slot');
      default: {
        const out: Expression[] = [];
        visitChildren(e, (c) => out.push(c));
        return out;
      }
    }
  }

  /** A carrier's regions, each on a stack seeded with the carrier's parameters, its label in scope. */
  private carrierBody(e: Expression, params: readonly ValueType[]): void {
    // A branch to a loop carries its parameters; to any other carrier, its results.
    const label = (e as { label: string }).label;
    const types = e.kind === ExpressionKind.Loop ? params : slots(typeOf(e as Expression));
    this.labels.push({ name: label, types });
    try {
      this.carrierRegions(e, params);
    } finally {
      this.labels.pop();
    }
  }

  private carrierRegions(e: Expression, params: readonly ValueType[]): void {
    switch (e.kind) {
      case ExpressionKind.Block:
        this.region(e.children, params);
        return;
      case ExpressionKind.Loop:
        this.regionNode(e.body, params);
        return;
      case ExpressionKind.If:
        this.regionNode(e.ifTrue, params);
        if (e.ifFalse !== null) this.regionNode(e.ifFalse, params);
        return;
      case ExpressionKind.TryTable:
        this.regionNode(e.body, params);
        return;
      case ExpressionKind.Try:
        this.regionNode(e.body, params);
        // A handler starts with what was thrown: the tag's values, then the
        // exnref for a `_ref` clause.
        for (const c of e.catches) {
          const thrown = c.tag === undefined ? [] : [...this.m.tags.get(c.tag).sig.params];
          this.regionNode(c.body, c.isRef ? [...thrown, ValType.ExnRef] : thrown);
        }
        return;
    }
  }

  private local(v: W.Var): ValueType {
    const l = v.kind === 'index'
      ? this.locals[v.value]
      : this.locals.find((x) => x.name === v.name);
    if (l === undefined) throw new Error(`derive-types: no local ${JSON.stringify(v)}`);
    return l.type;
  }

  private typeEntry(v: W.Var): W.TypeEntry {
    return this.m.types.get(v);
  }

  /** A GC type's new instance: `(ref $T)`, as the decoder types it. */
  private gcRef(v: W.Var): ValueType {
    return { heapType: v.kind === 'index' ? v : W_index(this.m.typeIndex(v)), nullable: false };
  }

  /** `(ref (exact $T))` — what an allocation is under custom descriptors. */
  private gcRefExact(v: W.Var): ValueType {
    return {
      heapType: heapExact(v.kind === 'index' ? v : W_index(this.m.typeIndex(v))),
      nullable: false,
    };
  }

  /**
   * A field's value on the stack, for a read WITHOUT a sign (a signed read is
   * `i32`). A packed field can only be read with one, and a field must
   * exist; either failing is invalid code, refused rather than typed.
   */
  private fieldValue(f: W.Field | undefined, what: string): ValueType {
    if (f === undefined) throw new Error(`derive-types: ${what} names no such field`);
    const t = f.type;
    if (t === Packed.I8 || t === Packed.I16) {
      throw new Error(`derive-types: ${what} reads a packed field without a sign`);
    }
    return t as ValueType;
  }

  private typeOfNode(e: Expression): Type {
    switch (e.kind) {
      // Carriers declare theirs.
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.If:
      case ExpressionKind.Try:
      case ExpressionKind.TryTable:
        return e.type!;

      case ExpressionKind.Const:
        return e.value.type as ValueType;
      case ExpressionKind.Nop:
      case ExpressionKind.Drop:
      case ExpressionKind.LocalSet:
      case ExpressionKind.GlobalSet:
      case ExpressionKind.Store:
      case ExpressionKind.MemoryCopy:
      case ExpressionKind.MemoryFill:
      case ExpressionKind.MemoryInit:
      case ExpressionKind.DataDrop:
      case ExpressionKind.TableSet:
      case ExpressionKind.TableFill:
      case ExpressionKind.TableCopy:
      case ExpressionKind.TableInit:
      case ExpressionKind.ElemDrop:
      case ExpressionKind.AtomicStore:
      case ExpressionKind.AtomicFence:
      case ExpressionKind.StructSet:
      case ExpressionKind.ArraySet:
      case ExpressionKind.ArrayFill:
      case ExpressionKind.ArrayCopy:
      case ExpressionKind.ArrayInitData:
      case ExpressionKind.ArrayInitElem:
      case ExpressionKind.CodeMetadata:
        return None;
      case ExpressionKind.Unreachable:
      case ExpressionKind.Return:
      case ExpressionKind.Switch:
      case ExpressionKind.Throw:
      case ExpressionKind.ThrowRef:
      case ExpressionKind.Rethrow:
        return Unreachable;
      case ExpressionKind.Break:
        // A `br_if` falls through with its target's values — what the
        // factory's rule (its operands' types) gives on a well-formed tree, and
        // right on one whose value the tree left as a sibling (see `leave`).
        //
        // 🔧 Unless an operand is UNREACHABLE, which makes the whole thing
        // unreachable (upstream `Break::finalize`): `(drop (br_if $l (br $l
        // (i32.const 8)) (i32.const 1)))` was typed i32 here and `unreachable`
        // by binaryen-ts's decoder — the optimizer removes what follows an
        // unreachable-typed node, so the two routes saw different programs
        // (One front end, stage 1, 2026-09-19; 6 nodes in the spec corpus).
        if (e.condition === undefined) return typeOf(makeBreak('', e.condition, e.values));
        if (typeOf(e.condition) === Unreachable) return Unreachable;
        if (e.values.some((v) => typeOf(v) === Unreachable)) return Unreachable;
        return resultOf(this.carried(e.target));

      case ExpressionKind.LocalGet:
      case ExpressionKind.LocalTee:
        return this.local(e.var);
      case ExpressionKind.GlobalGet:
        return this.m.globals.get(e.var).type;

      case ExpressionKind.Unary:
        return typeOf(makeUnary(e.opcode, e.value));
      case ExpressionKind.Binary:
        return typeOf(makeBinary(e.opcode, e.left, e.right));
      case ExpressionKind.Select:
        return typeOf(makeSelect(e.val1, e.val2, e.condition, e.resultType));
      case ExpressionKind.Quaternary:
        return [ValType.I64, ValType.I64];

      case ExpressionKind.Load:
        // A SIMD load written in text arrives as a plain `load` (the bridge
        // routed it to makeSIMDLoad, whose type is v128).
        return anyOpcodeName(e.opcode).startsWith('v128.')
          ? ValType.V128
          : typeOf(makeLoad(e.opcode, e.offset, e.align, e.address));
      case ExpressionKind.SIMDLoad:
        return ValType.V128;
      case ExpressionKind.SIMDLoadStoreLane:
        return typeOf(makeSIMDLoadStoreLane(e.opcode, e.address, e.vec, e.offset, e.align, e.lane));
      case ExpressionKind.SIMDExtract:
        return typeOf(makeSIMDExtract(e.opcode, e.vec, e.lane));
      case ExpressionKind.SIMDReplace:
      case ExpressionKind.SIMDShuffle:
      case ExpressionKind.SIMDTernary:
        return ValType.V128;
      case ExpressionKind.MemorySize:
        return typeOf(
          makeMemorySize(e.memidx, addressTypeOf(this.m.memories.get(e.memidx).limits)),
        );
      case ExpressionKind.MemoryGrow:
        return typeOf(
          makeMemoryGrow(e.delta, e.memidx, addressTypeOf(this.m.memories.get(e.memidx).limits)),
        );
      case ExpressionKind.AtomicLoad:
        return typeOf(makeAtomicLoad(e.opcode, e.offset, e.align, e.address));
      case ExpressionKind.AtomicRMW:
        return typeOf(makeAtomicRmw(e.opcode, e.offset, e.align, e.address, e.value));
      case ExpressionKind.AtomicCmpxchg:
        return typeOf(
          makeAtomicCmpxchg(e.opcode, e.offset, e.align, e.address, e.expected, e.replacement),
        );
      case ExpressionKind.AtomicWait:
      case ExpressionKind.AtomicNotify:
        return ValType.I32;

      case ExpressionKind.Call:
        return resultOf(this.m.funcs.get(e.func).sig.results);
      case ExpressionKind.CallIndirect:
        return typeOf(makeCallIndirect(e.table, e.callee, e.operands, e.sig));
      case ExpressionKind.CallRef: {
        const t = this.typeEntry(e.sigType);
        if (t.kind !== 'func') throw new Error('derive-types: call_ref names a non-function type');
        return resultOf(t.sig.results);
      }

      case ExpressionKind.TableGet:
        return this.m.tables.get(e.table).elemType;
      case ExpressionKind.TableSize:
        return typeOf(makeTableSize(e.table, addressTypeOf(this.m.tables.get(e.table).limits)));
      case ExpressionKind.TableGrow:
        return typeOf(
          makeTableGrow(
            e.table,
            e.value,
            e.delta,
            addressTypeOf(this.m.tables.get(e.table).limits),
          ),
        );

      case ExpressionKind.RefNull:
        return refNullType(e.refType);
      case ExpressionKind.RefFunc:
        return ValType.FuncRef;
      case ExpressionKind.RefIsNull:
      case ExpressionKind.RefEq:
      case ExpressionKind.RefTest:
      case ExpressionKind.I31Get:
      case ExpressionKind.ArrayLen:
        return ValType.I32;
      case ExpressionKind.RefAs: {
        // The operand's type made non-nullable, as the decoder types it.
        const t = typeOf(e.value);
        return isRefType(t) ? { ...t, nullable: false } : t;
      }
      case ExpressionKind.RefI31:
        return { heapType: heapAbstract(AbstractHeapType.I31), nullable: false };
      case ExpressionKind.AnyConvertExtern:
      case ExpressionKind.ExternConvertAny:
        return typeOf(makeExternConvert(e.kind, e.value));
      case ExpressionKind.RefCast:
        return { heapType: e.heapType, nullable: e.nullable } as ValueType;
      case ExpressionKind.RefGetDesc: {
        // `(ref (exact? $y))`, `$y` the descriptor of the named type; exact
        // when the operand is.
        const t = this.typeEntry(e.typeVar);
        if (t.descriptor === undefined) {
          throw new Error('derive-types: ref.get_desc names a type without a descriptor');
        }
        const operand = typeOf(e.ref);
        const exact = isRefType(operand) && operand.heapType.kind === 'exact';
        return exact ? this.gcRefExact(t.descriptor) : this.gcRef(t.descriptor);
      }
      case ExpressionKind.BrOn:
        // The operand's type, as the decoder and the bridge both give it.
        return typeOf(e.ref);

      case ExpressionKind.StructNew: {
        // The `_desc` pair exists only under custom descriptors, where every
        // allocation is exact. The plain pair is exact where the module speaks
        // exact types (`speaksExactTypes`), and `(ref $T)` where it does not.
        return e.desc !== undefined || this.m.exactAllocations
          ? this.gcRefExact(e.typeVar)
          : this.gcRef(e.typeVar);
      }
      case ExpressionKind.ArrayNew:
      case ExpressionKind.ArrayNewFixed:
      case ExpressionKind.ArrayNewData:
      case ExpressionKind.ArrayNewElem:
        return this.m.exactAllocations ? this.gcRefExact(e.typeVar) : this.gcRef(e.typeVar);
      case ExpressionKind.StructGet: {
        if (e.signed !== undefined) return ValType.I32;
        const t = this.typeEntry(e.typeVar);
        if (t.kind !== 'struct') {
          throw new Error('derive-types: struct.get names a non-struct type');
        }
        return this.fieldValue(fieldAt(t.fields, e.fieldVar), 'struct.get');
      }
      case ExpressionKind.ArrayGet: {
        if (e.signed !== undefined) return ValType.I32;
        const t = this.typeEntry(e.typeVar);
        if (t.kind !== 'array') throw new Error('derive-types: array.get names a non-array type');
        return this.fieldValue(t.field, 'array.get');
      }

      case ExpressionKind.Pop:
      case ExpressionKind.Region:
        throw new Error(`derive-types: ${e.kind} is typed by its context`);
    }
  }
}

/** A struct's field, by index or by name. */
function fieldAt(fields: readonly W.Field[], v: W.Var): W.Field | undefined {
  return v.kind === 'index' ? fields[v.value] : fields.find((f) => f.name === v.name);
}

function W_index(i: number): W.Var {
  return { kind: 'index', value: i };
}

/** A carrier's parameters, or `undefined` for a node that is not a carrier. */
function carrierParams(e: Expression): { types: readonly ValueType[] } | undefined {
  switch (e.kind) {
    case ExpressionKind.Block:
    case ExpressionKind.Loop:
    case ExpressionKind.If:
    case ExpressionKind.Try:
    case ExpressionKind.TryTable:
      return { types: e.params?.types ?? [] };
    default:
      return undefined;
  }
}

/**
 * Whether `m` already speaks exact types: a type with a `descriptor` /
 * `describes` clause, or `(exact $T)` anywhere in its declarations (types,
 * signatures, locals, globals, tables, imports). Such a module is valid only
 * under custom descriptors, so an exact type written into it is valid too —
 * and it is what the proposal says an allocation IS.
 *
 * 🔧 Open-work 9, found a defect by the proposals behaviour gate (2026-09-29):
 * allocations derived INEXACT, so `--flatten` gave `(struct.new $b)` a
 * `(ref $b)` temporary and `struct.new_desc $a (local.get $t)` — which needs
 * `(ref null (exact $b))` — came out invalid. A module that never mentions
 * exact types keeps `(ref $T)`: written into one without the feature, an exact
 * type would not validate.
 */
function speaksExactTypes(m: WasmModule): boolean {
  if (
    m.types.some((t) =>
      'descriptor' in t && (t.descriptor !== undefined || t.describes !== undefined)
    )
  ) {
    return true;
  }
  // Limits are u64 `bigint`s (1.7.1), which JSON cannot serialize: spelled as
  // strings. 🔧 Without the replacer every module importing a memory or table
  // threw here, and the threads suite's variants were all refused.
  const declarations = JSON.stringify(
    [
      m.types,
      m.imports,
      m.globals.map((g) => g.type),
      m.tables.map((t) => t.elemType),
      m.functions.map((f) => [f.sig, f.locals]),
    ],
    (_, v) => typeof v === 'bigint' ? v.toString() : v,
  );
  return declarations.includes('"kind":"exact"');
}

/** The module context every function's derivation reads. */
class Module {
  readonly funcs: Space<{ name: string; sig: W.FuncSignature }>;
  readonly globals: Space<{ name: string; type: ValueType }>;
  readonly tables: Space<{ name: string; elemType: ValueType; limits: W.Limits }>;
  readonly memories: Space<{ name: string; limits: W.Limits }>;
  readonly tags: Space<{ name: string; sig: W.FuncSignature }>;
  readonly types: Space<W.TypeEntry>;
  private readonly typeNames: readonly string[];

  constructor(m: WasmModule) {
    const imported = <K extends ExternalKind, T>(kind: K, pick: (i: W.Import) => T): T[] =>
      m.imports.filter((i) => i.kind === kind).map(pick);
    this.funcs = new Space([
      ...imported(
        ExternalKind.Func,
        (i) => (i as Extract<W.Import, { kind: ExternalKind.Func }>).func,
      ),
      ...m.functions,
    ], 'function');
    this.globals = new Space([
      ...imported(
        ExternalKind.Global,
        (i) => (i as Extract<W.Import, { kind: ExternalKind.Global }>).global,
      ),
      ...m.globals,
    ], 'global');
    this.tables = new Space([
      ...imported(
        ExternalKind.Table,
        (i) => (i as Extract<W.Import, { kind: ExternalKind.Table }>).table,
      ),
      ...m.tables,
    ], 'table');
    this.memories = new Space([
      ...imported(
        ExternalKind.Memory,
        (i) => (i as Extract<W.Import, { kind: ExternalKind.Memory }>).memory,
      ),
      ...m.memories,
    ], 'memory');
    this.tags = new Space([
      ...imported(
        ExternalKind.Tag,
        (i) => (i as Extract<W.Import, { kind: ExternalKind.Tag }>).tag,
      ),
      ...m.tags,
    ], 'tag');
    this.types = new Space(m.types, 'type');
    this.typeNames = m.types.map((t) => t.name);
    this.exactAllocations = speaksExactTypes(m);
  }

  /**
   * Whether an allocation derives EXACT (`(ref (exact $T))`, the custom
   * descriptors typing) rather than `(ref $T)`. See {@link speaksExactTypes}.
   */
  readonly exactAllocations: boolean;

  typeIndex(v: W.Var): number {
    if (v.kind === 'index') return v.value;
    const i = this.typeNames.indexOf(v.name);
    if (i < 0) throw new Error(`derive-types: no type ${v.name}`);
    return i;
  }
}

/**
 * Set every expression node's `type` in `m` — every function body and every
 * constant expression — as binaryen-ts's factories and decoder type them. In
 * place. See the module doc.
 */
export function deriveTypes(m: WasmModule, popSources?: PopSources): void {
  const mod = new Module(m);
  const constant = (r: W.RegionExpr | undefined) => {
    if (r !== undefined) {
      (r as Mut<W.RegionExpr>).type = new Deriver(mod, [], [], '').region(r.children, []);
    }
  };
  for (const g of m.globals) constant(g.init);
  for (const t of m.tables) constant(t.init);
  for (const d of m.dataSegments) constant(d.offset);
  for (const s of m.elements) {
    constant(s.offset);
    for (const entry of s.elemExprs) constant(entry);
  }
  // An IMPORTED function has no code, and its record carries an empty body:
  // `none`, as binaryen-ts's decoder types it. Left untyped, it was the one
  // difference between the two routes on 3,381 corpus modules (One front end,
  // stage 1).
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Func) (imp.func.body as Mut<W.RegionExpr>).type = None;
  }
  for (const f of m.functions) {
    const body = f.body as Mut<W.RegionExpr>;
    body.type = new Deriver(mod, f.locals, f.sig.results, f.bodyFrameLabel ?? '', popSources)
      .region(f.body.children, []);
  }
}
