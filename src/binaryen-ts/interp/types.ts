/**
 * @module binaryen-ts/interp/types
 *
 * Run-time type identity for the interpreter (open-work 23, E3d-2): what makes
 * two defined types THE SAME type, and one a subtype of another, across
 * modules — what `ref.test`, `ref.cast`, `br_on_cast` and `call_indirect` ask.
 *
 * **Iso-recursive canonicalisation, as the GC spec defines it.** A type's
 * identity is its REC GROUP's structure plus its position in it. Each group
 * is serialised with every reference to a type in the same group written as
 * its RELATIVE index, and every reference to an earlier group written as THAT
 * type's canonical key; the key is interned in one process-wide registry. Two
 * modules that define structurally identical groups therefore get the same
 * {@link RttType} object, and identity is `===`. Two structurally identical
 * types in DIFFERENT groups (`(rec (type (func)) (type (struct)))` vs a plain
 * `(type (func))`) get different keys, as they must.
 *
 * **Subtyping** is declared: `(sub $super …)`. `t <: u` when `u` is `t` or is
 * on `t`'s chain of declared supertypes. The abstract heap types sit above the
 * defined ones — any ⊇ eq ⊇ {i31, struct ⊇ every struct type, array ⊇ every
 * array type}; func ⊇ every function type; extern; exn — with `none`,
 * `nofunc`, `noextern`, `noexn` at the bottom, which only null inhabits.
 *
 * @license MIT
 */

import type { AbstractHeap } from '../../wabt-ts/core/types.ts';
import {
  type FuncSignature,
  type HeapTypeRef,
  isRefValueType,
  recGroups,
  type StorageType,
  type TypeEntry,
  type ValueType,
  type Var,
} from '../../wabt-ts/ir/ir.ts';

/** A defined type's run-time identity — one object per canonical type, shared by every module. */
export class RttType {
  /** Direct declared supertypes, canonical. */
  supers: RttType[] = [];
  constructor(
    readonly key: string,
    readonly kind: 'func' | 'struct' | 'array',
  ) {}

  /** Whether this type is `u` or a declared subtype of it. */
  isSubtypeOf(u: RttType): boolean {
    if (this === u) return true;
    return this.supers.some((s) => s.isSubtypeOf(u));
  }
}

const REGISTRY = new Map<string, RttType>();

/** The canonical {@link RttType}s of one module's type section, by index. */
export class ModuleTypes {
  readonly types: RttType[] = [];
  private readonly names: string[];

  constructor(readonly entries: readonly TypeEntry[]) {
    this.names = entries.map((e) => e.name);
    for (const g of recGroups(entries)) {
      // An empty `(rec)` defines no type. A singleton group and a type written
      // without `(rec …)` are the SAME type — `(type t)` abbreviates
      // `(rec (type t))` — so whether the group was written is not part of a key.
      if (g.count > 0) this.canonicaliseGroup(g.start, g.count);
    }
  }

  /** The index a type `Var` names. */
  index(v: Var): number {
    const i = v.kind === 'index' ? v.value : this.names.indexOf(v.name);
    if (i < 0 || i >= this.entries.length) {
      throw new Error(`interp: unknown type ${JSON.stringify(v)}`);
    }
    return i;
  }

  /** The canonical type a `Var` names. */
  of(v: Var): RttType {
    return this.types[this.index(v)]!;
  }

  /**
   * The canonical type of a signature written INLINE (no type index): an
   * implicit singleton group, `final`, no supertypes — the same key a
   * `(type (func …))` of that signature gets.
   */
  ofSig(sig: FuncSignature): RttType {
    const val = (t: ValueType): string =>
      typeof t === 'object' && isRefValueType(t)
        ? `(ref${t.nullable ? ' null' : ''} ${
          t.heapType.kind === 'abstract'
            ? t.heapType.name
            : t.heapType.kind === 'exact'
            ? `exact(<${this.of(t.heapType.type).key}>)`
            : `<${this.of(t.heapType).key}>`
        })`
        : String(t);
    const key = `rec{final func(${sig.params.map(val).join(' ')})->(${
      sig.results.map(val).join(' ')
    })}#0`;
    let t = REGISTRY.get(key);
    if (t === undefined) {
      t = new RttType(key, 'func');
      REGISTRY.set(key, t);
    }
    return t;
  }

  private canonicaliseGroup(start: number, count: number): void {
    const ref = (v: Var): string => {
      const i = this.index(v);
      if (i >= start && i < start + count) return `rec.${i - start}`;
      if (i < start) return `<${this.types[i]!.key}>`;
      throw new Error('interp: a type refers forward past its rec group');
    };
    const heap = (h: HeapTypeRef): string =>
      h.kind === 'abstract' ? h.name : h.kind === 'exact' ? `exact(${ref(h.type)})` : ref(h);
    const val = (t: ValueType | StorageType): string =>
      typeof t === 'object' && isRefValueType(t)
        ? `(ref${t.nullable ? ' null' : ''} ${heap(t.heapType)})`
        : String(t);
    const sig = (s: FuncSignature): string =>
      `(${s.params.map(val).join(' ')})->(${s.results.map(val).join(' ')})`;
    const parts: string[] = [];
    for (let i = start; i < start + count; i++) {
      const e = this.entries[i]!;
      const sub = e.sub === undefined
        ? 'final'
        : `${e.sub.final ? 'final ' : ''}sub[${e.sub.supertypes.map(ref).join(',')}]`;
      const body = e.kind === 'func'
        ? `func${sig(e.sig)}`
        : e.kind === 'struct'
        ? `struct{${e.fields.map((f) => `${f.mutable ? 'mut ' : ''}${val(f.type)}`).join(',')}}`
        : `array[${e.field.mutable ? 'mut ' : ''}${val(e.field.type)}]`;
      // Descriptor clauses (custom descriptors) are part of a type's identity.
      const desc = `${e.describes ? ` describes ${ref(e.describes)}` : ''}${
        e.descriptor ? ` descriptor ${ref(e.descriptor)}` : ''
      }`;
      parts.push(`${sub} ${body}${desc}`);
    }
    const groupKey = `rec{${parts.join('; ')}}`;
    const created: RttType[] = [];
    for (let i = start; i < start + count; i++) {
      const key = `${groupKey}#${i - start}`;
      let t = REGISTRY.get(key);
      if (t === undefined) {
        t = new RttType(key, this.entries[i]!.kind);
        REGISTRY.set(key, t);
        created.push(t);
      }
      this.types[i] = t;
    }
    // Supertypes after every type of the group exists: a group may refer to itself.
    for (const t of created) {
      const i = this.types.indexOf(t);
      t.supers = (this.entries[i]!.sub?.supertypes ?? []).map((v) => this.of(v));
    }
  }
}

/** What a reference value IS, for matching against a heap type. */
export type RefShape =
  | { kind: 'null' }
  | { kind: 'i31' }
  | { kind: 'struct' | 'array' | 'func'; rtt: RttType }
  | { kind: 'extern' }
  | { kind: 'hostany' } // an extern value brought into `any` by `any.convert_extern`
  | { kind: 'exn' };

/** A heap type to match against, resolved: abstract, a defined type, or exactly one. */
export type ResolvedHeap =
  | { kind: 'abstract'; name: AbstractHeap }
  | { kind: 'defined'; rtt: RttType; exact: boolean };

/**
 * Whether a NON-NULL value of shape `v` is in heap type `h`. (Null is the
 * caller's: it is in every nullable reference type and no other.)
 */
export function inHeap(v: RefShape, h: ResolvedHeap): boolean {
  if (h.kind === 'defined') {
    if (v.kind !== 'struct' && v.kind !== 'array' && v.kind !== 'func') return false;
    return h.exact ? v.rtt === h.rtt : v.rtt.isSubtypeOf(h.rtt);
  }
  switch (h.name) {
    case 'any':
      return v.kind === 'i31' || v.kind === 'struct' || v.kind === 'array' || v.kind === 'hostany';
    case 'eq':
      return v.kind === 'i31' || v.kind === 'struct' || v.kind === 'array';
    case 'i31':
      return v.kind === 'i31';
    case 'struct':
      return v.kind === 'struct';
    case 'array':
      return v.kind === 'array';
    case 'func':
      return v.kind === 'func';
    case 'extern':
      return v.kind === 'extern';
    case 'exn':
      return v.kind === 'exn';
    default:
      // none, nofunc, noextern, noexn: only null.
      return false;
  }
}
