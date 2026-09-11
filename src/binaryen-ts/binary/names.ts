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
import type { ModuleNames, NameMap } from '../../wabt-ts/ir/apply-names.ts';
import type { ExplicitNames } from '../ir/module.ts';
import type { TypeDef } from '../ir/gc-types.ts';

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
  /** Labels a function has used so far, by function index — the section's and the made-up ones. */
  private readonly labelsUsed = new Map<number, Set<string>>();
  private readonly labelsGiven = new Map<number, Map<number, string>>();
  private readonly labelsExplicit = new Map<number, Set<string>>();

  constructor(bytes: Uint8Array) {
    const payload = findNameSection(bytes);
    this.hasSection = payload !== null;
    // A malformed section names nothing, as upstream binaryen warns and goes on.
    this.raw = payload === null ? null : (parseNameSection(payload)?.names ?? null);
    const n = this.raw;
    this.funcs = new Namespace(n?.funcNames, (i) => `$func${i}`);
    this.tables = new Namespace(n?.tableNames, (i) => `$table${i}`);
    this.memories = new Namespace(n?.memoryNames, (i) => `mem${i}`);
    this.globals = new Namespace(n?.globalNames, (i) => `$global${i}`);
    this.tags = new Namespace(n?.tagNames, (i) => `$tag${i}`);
    this.elems = new Namespace(n?.elemSegmentNames, (i) => `$elem${i}`);
    this.datas = new Namespace(n?.dataSegmentNames, (i) => `$data${i}`);
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
   * `funcName` maps a function index to its IR name; `typeDefs` are the decoded
   * types, index for index; `importFuncs` lists each imported function's name
   * by index.
   */
  explicit(
    funcName: (i: number) => string,
    typeDefs: readonly TypeDef[],
    importFuncs: readonly string[],
  ): ExplicitNames {
    const n = this.raw;
    const importParams = new Map<string, ReadonlyMap<number, string>>();
    importFuncs.forEach((name, i) => {
      const l = this.locals(i);
      if (l.size > 0) importParams.set(name, l);
    });
    const labels = new Map<string, ReadonlySet<string>>();
    for (const fi of n?.labelNames.keys() ?? []) {
      this.givenLabels(fi);
      const set = this.labelsExplicit.get(fi);
      if (set !== undefined && set.size > 0) labels.set(funcName(fi), set);
    }
    const types = new Map<TypeDef, string>();
    const typesUsed = new Set<string>();
    for (const [i, name] of n?.typeNames ?? []) {
      const def = typeDefs[i];
      if (def !== undefined && name !== '') types.set(def, unique(typesUsed, '$' + name));
    }
    const fields = new Map<TypeDef, ReadonlyMap<number, string>>();
    for (const [i, map] of n?.fieldNames ?? []) {
      const def = typeDefs[i];
      if (def === undefined || (def.kind !== 'struct' && def.kind !== 'array')) continue;
      const out = new Map<number, string>();
      const used = new Set<string>();
      for (const [j, name] of map) if (name !== '') out.set(j, unique(used, '$' + name));
      if (out.size > 0) fields.set(def, out);
    }
    return {
      ...(n?.moduleName ? { module: '$' + n.moduleName } : {}),
      functions: this.funcs.explicit,
      importParams,
      labels,
      types,
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
