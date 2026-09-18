// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/binary/names
 *
 * The decoder's names, one table per namespace, read from the `name` section
 * BEFORE anything is decoded. N1 step P4 (cmem/names.md).
 *
 * 🔧 The decoder skipped the name section and built every reference name from
 * its index on the spot — `$func${i}` at thirteen sites, `$tag`, `$global`,
 * `$table`, `$data`, `$elem` at the rest — so `$foo` came back `$func3`
 * whatever the binary said. binaryen-ts refers to entities BY NAME, so a name
 * from the section has to be the one every reference site uses: that is what
 * this table is, and why the section is found first — it comes after the code.
 *
 * - A section name wins; a duplicate gets `.1`, `.2`, … as upstream wabt's
 *   reader does (owner decision 2: a duplicate is not a fidelity target).
 * - An unnamed entity gets the name the decoder always gave it — `$func3`,
 *   `mem0` — so a module without a name section decodes exactly as before;
 *   only if the section already uses that name does it become `$func3.1`.
 * - {@link DecodedNames.explicit} records which names came from the section,
 *   for the encoder: those are written back, the made-up ones never are.
 */

import { parseNameSection } from '../../wabt-ts/reader/name-section.ts';
import { NameSectionSubsection } from '../../wabt-ts/core/binary.ts';
import type { ModuleNames, NameMap } from '../../wabt-ts/ir/apply-names.ts';
import type { ExplicitNames } from '../ir/module.ts';

function leb(bytes: Uint8Array, p: { i: number }): number | null {
  let r = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    const b = bytes[p.i++];
    if (b === undefined) return null;
    r += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return r;
  }
  return null;
}

/**
 * The LAST `name` section's payload (after its own name), found by walking
 * section headers only — or `null` when there is none, or the headers are
 * malformed (the real decode reports those; this must not).
 *
 * The last, because upstream binaryen, wabt and wasm-tools all name a module
 * with two from the later one; binaryen writes one section back, so the other
 * is dropped, as upstream drops it.
 */
export function findNameSection(bytes: Uint8Array): Uint8Array | null {
  const p = { i: 8 };
  let found: Uint8Array | null = null;
  while (p.i < bytes.length) {
    const id = bytes[p.i++]!;
    const size = leb(bytes, p);
    if (size === null) return null;
    const end = p.i + size;
    if (end > bytes.length) return null;
    if (id === 0) {
      const q = { i: p.i };
      const n = leb(bytes, q);
      if (n !== null && q.i + n <= end) {
        const name = new TextDecoder().decode(bytes.subarray(q.i, q.i + n));
        if (name === 'name') found = bytes.subarray(q.i + n, end);
      }
    }
    p.i = end;
  }
  return found;
}

/**
 * One namespace: index → name, the section's names first, disambiguated; the
 * made-up ones on demand, clear of every name the section uses.
 */
class Namespace {
  private readonly given = new Map<number, string>();
  private readonly used = new Set<string>();
  private readonly made = new Map<number, string>();
  readonly explicit = new Set<string>();
  private readonly synthetic: (i: number) => string;

  constructor(map: NameMap | undefined, synthetic: (i: number) => string) {
    this.synthetic = synthetic;
    for (const [i, n] of map ?? []) {
      if (n === '') continue;
      const name = unique(this.used, '$' + n);
      this.given.set(i, name);
      this.explicit.add(name);
    }
  }

  name(i: number): string {
    const g = this.given.get(i);
    if (g !== undefined) return g;
    let m = this.made.get(i);
    if (m === undefined) {
      m = unique(this.used, this.synthetic(i));
      this.made.set(i, m);
    }
    return m;
  }
}

/** `name`, or `name.1`, `name.2`, … — the first not in `used`; recorded there. */
function unique(used: Set<string>, name: string): string {
  let u = name;
  for (let n = 1; used.has(u); n++) u = `${name}.${n}`;
  used.add(u);
  return u;
}

/** The decoder's names for one module. See the module doc. */
export class DecodedNames {
  /** Whether the binary had a name section at all. */
  readonly hasSection: boolean;
  private readonly raw: ModuleNames | null;
  private readonly funcs: Namespace;
  private readonly tables: Namespace;
  private readonly memories: Namespace;
  private readonly globals: Namespace;
  private readonly tags: Namespace;
  private readonly elems: Namespace;
  private readonly datas: Namespace;
  private readonly types: Namespace;
  /** Each struct / array type's fields, by type index — made on first ask. */
  private readonly fieldSpaces = new Map<number, Namespace>();
  /** Labels a function has used so far, by function index — the section's and the made-up ones. */
  private readonly labelsUsed = new Map<number, Set<string>>();
  private readonly labelsGiven = new Map<number, Map<number, string>>();
  private readonly labelsExplicit = new Map<number, Set<string>>();

  /** Function INDICES the local subsection listed, or `null` when it had none (N6). */
  private readonly localsListed: ReadonlySet<number> | null;

  constructor(bytes: Uint8Array) {
    const payload = findNameSection(bytes);
    this.hasSection = payload !== null;
    // A malformed section names nothing, as upstream binaryen warns and goes on.
    const parsed = payload === null ? null : parseNameSection(payload);
    this.raw = parsed?.names ?? null;
    // An empty `localNames` cannot say whether the subsection was absent or
    // listed nobody, and those are different bytes — ask the parse.
    this.localsListed = parsed === null
      ? null
      : parsed.subsections.has(NameSectionSubsection.Local)
      ? new Set(parsed.names.localNames.keys())
      : null;
    const n = this.raw;
    this.funcs = new Namespace(n?.funcNames, (i) => `$func${i}`);
    this.tables = new Namespace(n?.tableNames, (i) => `$table${i}`);
    this.memories = new Namespace(n?.memoryNames, (i) => `mem${i}`);
    this.globals = new Namespace(n?.globalNames, (i) => `$global${i}`);
    this.tags = new Namespace(n?.tagNames, (i) => `$tag${i}`);
    this.elems = new Namespace(n?.elemSegmentNames, (i) => `$elem${i}`);
    this.datas = new Namespace(n?.dataSegmentNames, (i) => `$data${i}`);
    this.types = new Namespace(n?.typeNames, (i) => `$type${i}`);
  }

  /** Every index below is in its index space — imports first. */
  func(i: number): string {
    return this.funcs.name(i);
  }
  table(i: number): string {
    return this.tables.name(i);
  }
  memory(i: number): string {
    return this.memories.name(i);
  }
  global(i: number): string {
    return this.globals.name(i);
  }
  tag(i: number): string {
    return this.tags.name(i);
  }
  elem(i: number): string {
    return this.elems.name(i);
  }
  data(i: number): string {
    return this.datas.name(i);
  }
  /**
   * Type `i`'s name — the section's, or a made-up `$typeN` (owner decision 4
   * covers types and fields; M7c3b b0). It was left `''`, the name held apart
   * in `ExplicitNames.types` keyed by the `TypeDef` object.
   */
  type(i: number): string {
    return this.types.name(i);
  }
  /** Field `j` of type `ti`'s name — the section's, or a made-up `$fieldN`. */
  field(ti: number, j: number): string {
    let ns = this.fieldSpaces.get(ti);
    if (ns === undefined) {
      ns = new Namespace(this.raw?.fieldNames.get(ti), (k) => `$field${k}`);
      this.fieldSpaces.set(ti, ns);
    }
    return ns.name(j);
  }

  /** The module's own name, `$`-prefixed, or `''` — {@link WasmModule.name}. */
  moduleName(): string {
    const n = this.raw?.moduleName;
    return n ? '$' + n : '';
  }

  /**
   * An imported function's param names, as `addFunctionImport` takes them —
   * `undefined` for an unnamed one (M7c3a).
   */
  importParamNames(funcIdx: number, count: number): (string | undefined)[] {
    const l = this.locals(funcIdx);
    return Array.from({ length: count }, (_, i) => l.get(i));
  }

  /** Names of function `funcIdx`'s params and locals, by index, disambiguated. */
  locals(funcIdx: number): Map<number, string> {
    const out = new Map<number, string>();
    const used = new Set<string>();
    for (const [i, n] of this.raw?.localNames.get(funcIdx) ?? []) {
      if (n !== '') out.set(i, unique(used, '$' + n));
    }
    return out;
  }

  /**
   * The name of function `funcIdx`'s `labelIdx`-th label-introducing
   * instruction, counted in binary order — `undefined` when it has none.
   */
  label(funcIdx: number, labelIdx: number): string | undefined {
    const given = this.givenLabels(funcIdx);
    return given.get(labelIdx);
  }

  /**
   * A made-up label for function `funcIdx`, clear of the section's: `wanted`
   * unless the function already uses it.
   */
  freshLabel(funcIdx: number, wanted: string): string {
    this.givenLabels(funcIdx);
    return unique(this.labelsUsedBy(funcIdx), wanted);
  }

  private labelsUsedBy(funcIdx: number): Set<string> {
    let used = this.labelsUsed.get(funcIdx);
    if (used === undefined) {
      used = new Set();
      this.labelsUsed.set(funcIdx, used);
    }
    return used;
  }

  private givenLabels(funcIdx: number): Map<number, string> {
    let given = this.labelsGiven.get(funcIdx);
    if (given === undefined) {
      given = new Map();
      const used = this.labelsUsedBy(funcIdx);
      const explicit = new Set<string>();
      for (const [i, n] of this.raw?.labelNames.get(funcIdx) ?? []) {
        if (n === '') continue;
        const name = unique(used, '$' + n);
        given.set(i, name);
        explicit.add(name);
      }
      this.labelsGiven.set(funcIdx, given);
      this.labelsExplicit.set(funcIdx, explicit);
    }
    return given;
  }

  /**
   * What the module was read with, for {@link WasmModule.explicitNames}.
   * `funcName` maps a function index to its IR name. The module's name and
   * every param's name live on the module and the functions themselves
   * (M7c3a); every other entry is a SET of the real names — the names
   * themselves are on the entities, types and fields included (b0).
   */
  explicit(funcName: (i: number) => string): ExplicitNames {
    const n = this.raw;
    const labels = new Map<string, ReadonlySet<string>>();
    for (const fi of n?.labelNames.keys() ?? []) {
      this.givenLabels(fi);
      const set = this.labelsExplicit.get(fi);
      if (set !== undefined && set.size > 0) labels.set(funcName(fi), set);
    }
    // Fields by their TYPE's name, for the types the decoder asked about — a
    // struct or array; a func type has no fields to name.
    const fields = new Map<string, ReadonlySet<string>>();
    for (const [ti, ns] of this.fieldSpaces) {
      if (ns.explicit.size > 0) fields.set(this.type(ti), ns.explicit);
    }
    return {
      functions: this.funcs.explicit,
      // By NAME, so a pass that reorders or removes a function does not shift
      // someone else's entry into its place (N6).
      localsListed: this.localsListed === null
        ? null
        : new Set([...this.localsListed].map((i) => funcName(i))),
      labels,
      types: this.types.explicit,
      tables: this.tables.explicit,
      memories: this.memories.explicit,
      globals: this.globals.explicit,
      elements: this.elems.explicit,
      dataSegments: this.datas.explicit,
      tags: this.tags.explicit,
      fields,
    };
  }
}
