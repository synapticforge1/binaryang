// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `v128` for the behaviour differential. The JS API cannot pass or receive a
 * `v128`: calling an export with one in its signature throws a `TypeError` —
 * on the original and on every variant alike, so every SIMD invocation
 * "agreed" without being run (item 6, 2026-09-28: 12,000-odd of the suite's
 * invocations, most of the `simd_*` files).
 *
 * So each such export gets a WRAPPER, appended to the module: the same
 * signature with every `v128` spelled as two `i64` lanes, which rebuilds the
 * vectors (`i64x2.splat`, `i64x2.replace_lane`), calls the export, and splits
 * each vector result back into its lanes (`i64x2.extract_lane`). It is
 * appended to the BYTES — the original's and each variant's, the same way,
 * after the variant is made — so no pass under test ever sees it, and it is
 * written here, by hand, so the toolchain under test builds none of it.
 *
 * Appending needs no rewrite of what is there: a new type goes after the last
 * (its index is the count of types, rec-group members counted one by one), a
 * new function after the last defined one (imports first in the index space),
 * a new export and body at the ends of their sections. Nothing is renumbered.
 */

/** A value type as the manifests spell it. */
export type ManifestType = string;

/** An export's signature as the manifest shows it: argument and result types. */
export interface Sig {
  params: ManifestType[];
  results: ManifestType[];
}

/** The wrapper's export name for `field`. */
export const wrapperName = (field: string): string => `\u0000v128\u0000${field}`;

const VALTYPE: Record<string, number> = {
  i32: 0x7f,
  i64: 0x7e,
  f32: 0x7d,
  f64: 0x7c,
  v128: 0x7b,
  funcref: 0x70,
  externref: 0x6f,
};

/** Does this signature need a wrapper — and can one be written for it? */
export function needsWrapper(sig: Sig): boolean {
  const all = [...sig.params, ...sig.results];
  return all.includes('v128') && all.every((t) => t in VALTYPE);
}

// --- LEB128 -----------------------------------------------------------------

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

class Cursor {
  constructor(readonly b: Uint8Array, public p: number) {}
  u8(): number {
    if (this.p >= this.b.length) throw new Error('v128 wrapper: unexpected end of module');
    return this.b[this.p++]!;
  }
  uleb(): number {
    let r = 0, s = 0, x;
    do {
      x = this.u8();
      r += (x & 0x7f) * 2 ** s;
      s += 7;
    } while (x & 0x80);
    return r;
  }
  /** A signed LEB, value unneeded: skipped. */
  sleb(): void {
    while (this.u8() & 0x80);
  }
  name(): string {
    const n = this.uleb();
    const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  /** A value (or storage) type: one byte, or a typed reference and its heap type. */
  valtype(): void {
    const t = this.u8();
    if (t === 0x63 || t === 0x64) this.sleb();
  }
  limits(): void {
    const flags = this.u8();
    this.uleb();
    if (flags & 1) this.uleb();
  }
}

interface Section {
  id: number;
  /** Where the section starts (its id byte) and ends. */
  start: number;
  end: number;
  /** Where its payload starts. */
  body: number;
}

function sections(b: Uint8Array): Section[] {
  const out: Section[] = [];
  const c = new Cursor(b, 8);
  while (c.p < b.length) {
    const start = c.p;
    const id = c.u8();
    const size = c.uleb();
    out.push({ id, start, body: c.p, end: c.p + size });
    c.p += size;
  }
  return out;
}

/** How many TYPES the type section defines — every rec-group member counted. */
function countTypes(b: Uint8Array, s: Section | undefined): number {
  if (s === undefined) return 0;
  const c = new Cursor(b, s.body);
  let types = 0;
  const comptype = () => {
    const form = c.u8();
    if (form === 0x60) {
      for (let n = c.uleb(); n > 0; n--) c.valtype();
      for (let n = c.uleb(); n > 0; n--) c.valtype();
    } else if (form === 0x5f) {
      for (let n = c.uleb(); n > 0; n--) {
        c.valtype();
        c.u8();
      }
    } else if (form === 0x5e) {
      c.valtype();
      c.u8();
    } else if (form === 0x5d) {
      c.sleb(); // cont $ft
    } else {
      throw new Error(`v128 wrapper: unknown composite type 0x${form.toString(16)}`);
    }
  };
  const subtype = () => {
    if (b[c.p] === 0x50 || b[c.p] === 0x4f) {
      c.u8();
      for (let n = c.uleb(); n > 0; n--) c.uleb();
    }
    comptype();
    types++;
  };
  for (let n = c.uleb(); n > 0; n--) {
    if (b[c.p] === 0x4e) {
      c.u8();
      for (let m = c.uleb(); m > 0; m--) subtype();
    } else {
      subtype();
    }
  }
  return types;
}

/** How many FUNCTIONS the import section imports. */
function countFuncImports(b: Uint8Array, s: Section | undefined): number {
  if (s === undefined) return 0;
  const c = new Cursor(b, s.body);
  let funcs = 0;
  for (let n = c.uleb(); n > 0; n--) {
    c.name();
    c.name();
    const kind = c.u8();
    if (kind === 0x00) {
      c.uleb();
      funcs++;
    } else if (kind === 0x01) {
      c.valtype();
      c.limits();
    } else if (kind === 0x02) {
      c.limits();
    } else if (kind === 0x03) {
      c.valtype();
      c.u8();
    } else if (kind === 0x04) {
      c.u8();
      c.uleb();
    } else {
      throw new Error(`v128 wrapper: unknown import kind 0x${kind.toString(16)}`);
    }
  }
  return funcs;
}

/** Each function export: name → function index. */
function funcExports(b: Uint8Array, s: Section | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (s === undefined) return out;
  const c = new Cursor(b, s.body);
  for (let n = c.uleb(); n > 0; n--) {
    const name = c.name();
    const kind = c.u8();
    const idx = c.uleb();
    if (kind === 0x00) out.set(name, idx);
  }
  return out;
}

/** `s` with `count` more entries and `extra` appended; a new section when absent. */
function extend(
  b: Uint8Array,
  s: Section | undefined,
  id: number,
  count: number,
  extra: number[],
): number[] {
  let old = 0;
  let rest: number[] = [];
  if (s !== undefined) {
    const c = new Cursor(b, s.body);
    old = c.uleb();
    rest = [...b.subarray(c.p, s.end)];
  }
  const payload = [...uleb(old + count), ...rest, ...extra];
  return [id, ...uleb(payload.length), ...payload];
}

/** One wrapper: its type (a `func` comptype) and its body. */
function wrapper(sig: Sig, target: number): { type: number[]; body: number[] } {
  const wide = (ts: ManifestType[]) =>
    ts.flatMap((t) => t === 'v128' ? [0x7e, 0x7e] : [VALTYPE[t]!]);
  const wparams = wide(sig.params);
  const wresults = wide(sig.results);
  const type = [0x60, ...uleb(wparams.length), ...wparams, ...uleb(wresults.length), ...wresults];

  const code: number[] = [];
  let slot = 0;
  for (const t of sig.params) {
    if (t === 'v128') {
      // i64x2.splat(lo), then i64x2.replace_lane 1 (hi).
      code.push(0x20, ...uleb(slot), 0xfd, 0x12, 0x20, ...uleb(slot + 1), 0xfd, 0x1e, 0x01);
      slot += 2;
    } else {
      code.push(0x20, ...uleb(slot));
      slot += 1;
    }
  }
  code.push(0x10, ...uleb(target));
  // The results, into one local each (last on top, so set in reverse), then
  // back out in order, each vector as its two lanes.
  const locals = sig.results.map((_, i) => wparams.length + i);
  for (let i = sig.results.length - 1; i >= 0; i--) code.push(0x21, ...uleb(locals[i]!));
  sig.results.forEach((t, i) => {
    const l = uleb(locals[i]!);
    if (t === 'v128') code.push(0x20, ...l, 0xfd, 0x1d, 0x00, 0x20, ...l, 0xfd, 0x1d, 0x01);
    else code.push(0x20, ...l);
  });
  code.push(0x0b);
  const decls = sig.results.flatMap((t) => [0x01, VALTYPE[t]!]);
  const body = [...uleb(sig.results.length), ...decls, ...code];
  return { type, body: [...uleb(body.length), ...body] };
}

/**
 * `bytes` with a wrapper appended for each `sigs` entry that {@link needsWrapper}
 * and names a FUNCTION export, exported as {@link wrapperName}. The same input
 * gives the same output, so the original and a variant are instrumented alike.
 * A module with nothing to wrap comes back as it was.
 */
export function withV128Wrappers(bytes: Uint8Array, sigs: Map<string, Sig>): Uint8Array {
  const secs = sections(bytes);
  const find = (id: number) => secs.find((s) => s.id === id);
  const exports = funcExports(bytes, find(7));
  const todo = [...sigs].filter(([field, sig]) => needsWrapper(sig) && exports.has(field));
  if (todo.length === 0) return bytes;

  const firstType = countTypes(bytes, find(1));
  const funcSec = find(3);
  const defined = funcSec === undefined ? 0 : new Cursor(bytes, funcSec.body).uleb();
  const firstFunc = countFuncImports(bytes, find(2)) + defined;

  const types: number[] = [];
  const funcs: number[] = [];
  const exps: number[] = [];
  const bodies: number[] = [];
  todo.forEach(([field, sig], i) => {
    const w = wrapper(sig, exports.get(field)!);
    types.push(...w.type);
    funcs.push(...uleb(firstType + i));
    const name = new TextEncoder().encode(wrapperName(field));
    exps.push(...uleb(name.length), ...name, 0x00, ...uleb(firstFunc + i));
    bodies.push(...w.body);
  });

  // Rebuild in section order; a section this adds to that did not exist is
  // made at its place.
  const ORDER = [1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11];
  const add: Record<number, number[]> = { 1: types, 3: funcs, 7: exps, 10: bodies };
  const out: number[] = [...bytes.subarray(0, 8)];
  const emitted = new Set<number>();
  const emitMissingBefore = (rank: number) => {
    for (const id of [1, 3, 7, 10]) {
      if (!emitted.has(id) && find(id) === undefined && ORDER.indexOf(id) < rank) {
        out.push(...extend(bytes, undefined, id, todo.length, add[id]!));
        emitted.add(id);
      }
    }
  };
  for (const s of secs) {
    if (s.id !== 0) emitMissingBefore(ORDER.indexOf(s.id));
    if (s.id in add) {
      out.push(...extend(bytes, s, s.id, todo.length, add[s.id]!));
      emitted.add(s.id);
    } else {
      out.push(...bytes.subarray(s.start, s.end));
    }
  }
  emitMissingBefore(ORDER.length);
  return new Uint8Array(out);
}

/** A `v128` argument as the manifest spells it — lanes of `lane_type` — as two i64 lanes. */
export function v128Lanes(a: { lane_type?: string; value: unknown }): [bigint, bigint] {
  const lanes = a.value as string[];
  const width = { i8: 1, i16: 2, i32: 4, f32: 4, i64: 8, f64: 8 }[a.lane_type ?? ''];
  if (width === undefined) throw new Error(`v128 argument: lane type ${a.lane_type}`);
  const d = new DataView(new ArrayBuffer(16));
  lanes.forEach((v, i) => {
    const x = BigInt.asUintN(width * 8, BigInt(v));
    for (let k = 0; k < width; k++) d.setUint8(i * width + k, Number((x >> BigInt(8 * k)) & 0xffn));
  });
  return [d.getBigInt64(0, true), d.getBigInt64(8, true)];
}
