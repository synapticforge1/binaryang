// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/tools/wasm-bundle
 *
 * `wasm-bundle` (open-work 24): N standalone modules — WASI programs or
 * libraries, as `wasm-ld`, rustc, zig, TinyGo or wasic produced them — into
 * ONE module with ONE memory, on the IR: every index space renumbered on the
 * tree, every import shared once, every export kept under one namespace.
 * It took over wasmtk's `wasmbundle` (regexes over printed WAT, a guessed
 * relocation) by the owner's decision of 2026-10-06, and wasmtk imports it
 * back.
 *
 * **One memory, relocated EXACTLY — never a multi-memory mode** (owner,
 * 2026-10-06). Each input's whole memory image — its declared pages, data,
 * stack and heap alike — is laid out at its own base, one after another in
 * input order, so every address the module could legally touch on its own
 * stays inside its own region. What moves with it is every address the
 * PRODUCER marked: the tool-conventions Linking format (`linking` +
 * `reloc.CODE` / `reloc.DATA`, which `wasm-ld --emit-relocs` writes and our
 * assembler writes from `(@reloc data)` annotations) names each immediate
 * that holds an address, and the bundler consumes those entries as the
 * module is READ — tied to the instruction node at that byte, verified
 * against the value the code holds — before anything re-encodes a byte. A
 * stale entry (the code was rewritten after the link: TinyGo runs
 * `wasm-opt` after `wasm-ld`) is refused like a missing one. A module with
 * no marks at all is refused, or relocated by the address-range rule wasmtk
 * used (`unmarked: 'guess'`) with a printed warning — never silently.
 *
 * Beside the marked sites, the globals the linker conventions use for
 * addresses move with the image: `__stack_pointer`, `__heap_base`,
 * `__heap_end`, `__data_end`, `__memory_base`. A module linked with a
 * `__memory_base`-relative scheme (`R_WASM_MEMORY_ADDR_REL_SLEB`) is right by
 * construction once that global moves. Each module keeps its own tables: a
 * function pointer made in one module and called through another's
 * `call_indirect` is not supported.
 *
 * Bundle BEFORE optimising: the relocations are consumed here; `wasm-opt`
 * on the result is then safe (the Linking sections are not carried over).
 *
 * @license MIT
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import process from 'node:process';
import { readForPasses } from '../ir/prepare.ts';
import { writeWasm, writeWat } from '../ir/write-wasm.ts';
import { readWat, WatInputError } from './read-wat.ts';
import type { WasmModule } from '../ir/module.ts';
import { makeCall } from '../ir/expressions.ts';
import { None } from '../ir/types.ts';
import { BinarySection, ExternalKind } from '../../wabt-ts/core/binary.ts';
import { Type } from '../../wabt-ts/core/types.ts';
import { Result } from '../../wabt-ts/core/result.ts';
import type { Location } from '../../wabt-ts/core/error.ts';
import { ExprVisitor, type ExprVisitorDelegate } from '../../wabt-ts/ir/expr-visitor.ts';
import { FidelityTable } from '../../wabt-ts/ir/fidelity.ts';
import { unique } from '../../wabt-ts/ir/made-up-names.ts';
import {
  type BlockResult,
  type ConstExpr,
  constI32,
  type DataSegment,
  type ExplicitNames,
  type Expr,
  type Func,
  type FuncSignature,
  type Global,
  type HeapTypeRef,
  type Import,
  isRefValueType,
  type Limits,
  makeModule,
  type Memory,
  type Module,
  region,
  sigEquals,
  type ValueType,
  valueTypeEquals,
  type Var,
  varIndex,
  varName,
} from '../../wabt-ts/ir/ir.ts';
import {
  decodeLinkingSection,
  decodeRelocSection,
  LINKING_SECTION_NAME,
  type LinkingSection,
  type LinkingSymbol,
  RELOC_SECTION_PREFIX,
  type RelocEntry,
  relocIsMemoryAddr,
  relocIsMemoryRel,
  RelocType,
  relocTypeName,
  SYM_ABSOLUTE,
  SymbolKind,
} from '../../wabt-ts/core/linking.ts';

// ---------------------------------------------------------------------------
// Options and report
// ---------------------------------------------------------------------------

/** What to do when two inputs export the same name. */
export type ConflictPolicy = 'refuse' | 'prefix' | 'alias' | 'exclude';

/** Options for {@link bundle}. */
export interface BundleOptions {
  /**
   * Exports of the same name from two inputs: `refuse` (the default — the
   * conflicts are listed and nothing is written), `prefix` (each becomes
   * `<module>_<name>`), `alias` (the same, and every module involved must
   * have been given a name by the caller), `exclude` (none is exported).
   */
  onConflict: ConflictPolicy;
  /** Which inputs were NAMED by the caller (`--alias`), for the `alias` policy. */
  named: ReadonlySet<string>;
  /**
   * A module with no relocation marks: `refuse` (the default), or `guess` —
   * relocate every `i32.const` inside its static data's address range, as
   * wasmtk's `wasmmerge` did, and say so. Inexact: an arithmetic constant
   * that happens to fall in the range moves too.
   */
  unmarked: 'refuse' | 'guess';
  /** Which input's `_start` stays `_start`; the others' are prefixed. */
  start?: string | undefined;
  /** Progress lines; `undefined` for none. */
  log?: ((line: string) => void) | undefined;
}

/** One input: its name (the prefix on conflict, the module name other inputs import from) and its module. */
export interface BundleInput {
  name: string;
  module: WasmModule;
  /** Where it came from, for messages. */
  source?: string;
}

/** One input's part of the report. */
export interface InputReport {
  name: string;
  /** Its memory image's base address in the bundle, and its size in pages. */
  base: number;
  pages: number;
  /** How its addresses were found: the Linking format, the guessed range, or it has no memory. */
  relocation: 'linked' | 'guessed' | 'none';
  /** Entries read from `reloc.*` and verified against the code. */
  entries: number;
  /** Immediates, data words and globals moved. */
  moved: number;
  exports: string[];
  /** Custom sections dropped, by name. */
  dropped: string[];
}

/** One export-name conflict and how it was resolved. */
export interface ConflictReport {
  name: string;
  inputs: string[];
  resolution: 'prefix' | 'alias' | 'exclude';
}

/** What {@link bundle} did. */
export interface BundleReport {
  inputs: InputReport[];
  conflicts: ConflictReport[];
  /** Exports of the bundle, in order. */
  exports: { name: string; kind: string; from: string }[];
  /** The one memory. */
  memory: { pages: number; maxPages?: number };
  warnings: string[];
}

/** Thrown when the inputs cannot be bundled. The message says which input and why. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

const defaults: BundleOptions = {
  onConflict: 'refuse',
  named: new Set(),
  unmarked: 'refuse',
  log: (line) => console.log(line),
};

/** Globals that hold an address by the linker conventions: they move with the image. */
const ADDRESS_GLOBALS: ReadonlySet<string> = new Set([
  '__stack_pointer',
  '__heap_base',
  '__heap_end',
  '__data_end',
  '__memory_base',
]);

const PAGE = 65536;

type W<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Reading an input: its memory, its relocations, verified
// ---------------------------------------------------------------------------

/** A memarg-carrying node: a load, a store, an atomic, a SIMD lane access. */
type MemArgExpr = Expr & {
  readonly offset: bigint;
  readonly align: number;
  readonly opcode: number;
};

function hasMemArg(e: Expr): e is MemArgExpr {
  return 'offset' in e && typeof (e as { offset?: unknown }).offset === 'bigint' && 'align' in e;
}

/** The sites of one input that hold an address, found and verified. */
interface Sites {
  consts: ConstExpr[];
  memargs: MemArgExpr[];
  words: { segment: DataSegment; offset: number }[];
  entries: number;
}

/** Each index space's names, imports first — as the binary numbers them. */
interface Spaces {
  funcs: string[];
  globals: string[];
  tables: string[];
  memories: string[];
  tags: string[];
  types: string[];
  data: string[];
  elems: string[];
}

function spacesOf(m: Module): Spaces {
  const s: Spaces = {
    funcs: [],
    globals: [],
    tables: [],
    memories: [],
    tags: [],
    types: m.types.map((t) => t.name),
    data: m.dataSegments.map((d) => d.name),
    elems: m.elements.map((e) => e.name),
  };
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Func) s.funcs.push(imp.func.name);
    else if (imp.kind === ExternalKind.Global) s.globals.push(imp.global.name);
    else if (imp.kind === ExternalKind.Table) s.tables.push(imp.table.name);
    else if (imp.kind === ExternalKind.Memory) s.memories.push(imp.memory.name);
    else if (imp.kind === ExternalKind.Tag) s.tags.push(imp.tag.name);
  }
  s.funcs.push(...m.functions.map((f) => f.name));
  s.globals.push(...m.globals.map((g) => g.name));
  s.tables.push(...m.tables.map((t) => t.name));
  s.memories.push(...m.memories.map((x) => x.name));
  s.tags.push(...m.tags.map((t) => t.name));
  return s;
}

function indexOfName(space: readonly string[], v: Var): number {
  if (v.kind === 'index') return v.value;
  const i = space.indexOf(v.name);
  return i;
}

/** The value of a constant expression that is one `i32.const`, or `undefined`. */
function constOffset(r: { children: Expr[] } | undefined): number | undefined {
  if (r === undefined || r.children.length !== 1) return undefined;
  const c = r.children[0]!;
  if (c.kind !== 'const' || c.value.type !== Type.I32) return undefined;
  return c.value.value >>> 0;
}

function readI32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) | 0;
}

/** Move an `i32.const` by `delta`, wrapping as the engine would. */
function shiftConst(c: ConstExpr, delta: number, what: string): void {
  if (c.value.type !== Type.I32) {
    throw new BundleError(`${what}: an address site is not an i32.const`);
  }
  (c as W<ConstExpr>).value = constI32((c.value.value + delta) | 0);
}

function writeI32(bytes: Uint8Array, at: number, v: number): void {
  bytes[at] = v & 0xff;
  bytes[at + 1] = (v >>> 8) & 0xff;
  bytes[at + 2] = (v >>> 16) & 0xff;
  bytes[at + 3] = (v >>> 24) & 0xff;
}

function lebLength(v: number): number {
  let n = 1;
  while (v >= 0x80) {
    v >>>= 7;
    n++;
  }
  return n;
}

/** Every instruction node of every function body, by the byte its opcode sat at. */
function nodesByOffset(m: Module): Map<number, Expr> {
  const at = new Map<number, Expr>();
  const d: ExprVisitorDelegate = {
    everyExpr(e) {
      if (e.loc !== undefined && e.kind !== 'pop') at.set(e.loc.offset, e);
    },
  };
  const v = new ExprVisitor(d);
  for (const f of m.functions) v.visitFunc(f);
  return at;
}

/** The `linking` section and the `reloc.*` sections of `m`, by the section each relocates. */
function linkingOf(
  m: Module,
  what: string,
): { linking: LinkingSection; relocs: Map<BinarySection, RelocEntry[]> } | undefined {
  const linkingCustom = m.customSections.find((c) => c.name === LINKING_SECTION_NAME);
  if (linkingCustom === undefined || linkingCustom.data === null) return undefined;
  const linking = decodeLinkingSection(linkingCustom.data);
  const relocs = new Map<BinarySection, RelocEntry[]>();
  for (const c of m.customSections) {
    if (!c.name.startsWith(RELOC_SECTION_PREFIX) || c.data === null) continue;
    const r = decodeRelocSection(c.data, c.name);
    const meta = m.sectionMeta[r.section];
    if (meta === undefined) {
      throw new BundleError(
        `${what}: ${c.name} relocates section ${r.section}, which the module has no record of`,
      );
    }
    if (meta.section === BinarySection.Custom) continue; // DWARF: the sections are dropped
    relocs.set(meta.section, [...(relocs.get(meta.section) ?? []), ...r.entries]);
  }
  return { linking, relocs };
}

/** A symbol's address in the module's own memory, or `undefined` for one that has none. */
function symbolAddress(
  sym: LinkingSymbol,
  segmentBases: readonly (number | undefined)[],
): number | undefined {
  if (sym.kind !== SymbolKind.Data) return undefined;
  if ((sym.flags & SYM_ABSOLUTE) !== 0) return (sym.offset ?? 0) >>> 0;
  if (sym.segment === undefined) return undefined; // undefined symbol: the addend is the address
  const base = segmentBases[sym.segment];
  if (base === undefined) return undefined;
  return (base + (sym.offset ?? 0)) >>> 0;
}

/**
 * Tie every `reloc.CODE` / `reloc.DATA` entry of a LINKED module to the node
 * or data word at its byte, verify the value the code holds against the
 * symbol it names, and return the address sites. An address entry whose
 * byte holds no instruction of the right kind, or a value other than the
 * symbol's, is stale — refused.
 */
function linkedSites(
  m: Module,
  what: string,
  linking: LinkingSection,
  relocs: Map<BinarySection, RelocEntry[]>,
): Sites {
  const sp = spacesOf(m);
  const at = nodesByOffset(m);
  const segmentBases = m.dataSegments.map((d) =>
    d.kind === 'active' ? constOffset(d.offset) : undefined
  );
  const sites: Sites = { consts: [], memargs: [], words: [], entries: 0 };
  const stale = (e: RelocEntry, found: string): never => {
    throw new BundleError(
      `${what}: ${relocTypeName(e.type)} at offset 0x${
        e.offset.toString(16)
      } does not match the code (${found}). ` +
        'The module was rewritten after it was linked (TinyGo runs wasm-opt after wasm-ld; so does any ' +
        'optimizer), so its relocations are stale. Link the object with `wasm-ld --emit-relocs` and bundle ' +
        'that output before optimising.',
    );
  };
  const symbol = (e: RelocEntry): LinkingSymbol => {
    const s = linking.symbols[e.index];
    if (s === undefined) {
      throw new BundleError(
        `${what}: relocation names symbol ${e.index}, of ${linking.symbols.length}`,
      );
    }
    return s;
  };
  const expectedAddress = (e: RelocEntry): number | undefined => {
    const addr = symbolAddress(symbol(e), segmentBases);
    return addr === undefined ? undefined : (addr + e.addend) | 0;
  };
  const sameIndex = (e: RelocEntry, v: Var, space: readonly string[]): void => {
    const sym = symbol(e);
    if (sym.index === undefined) return;
    const have = indexOfName(space, v);
    if (have !== sym.index) stale(e, `index ${have}, the symbol says ${sym.index}`);
  };

  const codeMeta = m.sectionMeta.find((s) => s.section === BinarySection.Code);
  for (const e of relocs.get(BinarySection.Code) ?? []) {
    if (codeMeta === undefined) throw new BundleError(`${what}: reloc.CODE without a code section`);
    sites.entries++;
    const abs = codeMeta.offset + e.offset;
    switch (e.type) {
      case RelocType.MemoryAddrSleb:
      case RelocType.MemoryAddrRelSleb: {
        const n = at.get(abs - 1);
        if (n === undefined || n.kind !== 'const' || n.value.type !== Type.I32) {
          return stale(e, n === undefined ? 'no instruction there' : `a ${n.kind}`);
        }
        const want = expectedAddress(e);
        if (want !== undefined && n.value.value !== want) {
          stale(e, `i32.const ${n.value.value}, the symbol says ${want}`);
        }
        // A `__memory_base`-relative value moves with the base global, not here.
        if (!relocIsMemoryRel(e.type)) sites.consts.push(n);
        break;
      }
      case RelocType.MemoryAddrLeb: {
        let n: Expr | undefined;
        for (const d of [2, 3, 4]) {
          const c = at.get(abs - d);
          if (c !== undefined && hasMemArg(c)) {
            const op = c.opcode;
            const immediate = (op > 0xff ? 1 + lebLength(op & 0xffff) : 1) + lebLength(c.align);
            if (immediate === d) n = c;
          }
        }
        if (n === undefined || !hasMemArg(n)) return stale(e, 'no memory instruction there');
        const want = expectedAddress(e);
        if (want !== undefined && Number(n.offset) !== (want >>> 0)) {
          stale(e, `offset=${n.offset}, the symbol says ${want >>> 0}`);
        }
        sites.memargs.push(n);
        break;
      }
      case RelocType.FunctionIndexLeb: {
        const n = at.get(abs - 1);
        if (n !== undefined && (n.kind === 'call' || n.kind === 'ref.func')) {
          sameIndex(e, n.func, sp.funcs);
        }
        break;
      }
      case RelocType.GlobalIndexLeb: {
        const n = at.get(abs - 1);
        if (n !== undefined && (n.kind === 'global.get' || n.kind === 'global.set')) {
          sameIndex(e, n.var, sp.globals);
        }
        break;
      }
      case RelocType.TypeIndexLeb: {
        const n = at.get(abs - 1);
        if (n !== undefined && n.kind === 'call_indirect' && n.typeVar !== undefined) {
          const have = indexOfName(sp.types, n.typeVar);
          if (have !== e.index) stale(e, `type ${have}, the entry says ${e.index}`);
        }
        break;
      }
      case RelocType.TagIndexLeb: {
        const n = at.get(abs - 1);
        if (n !== undefined && n.kind === 'throw') sameIndex(e, n.tag, sp.tags);
        break;
      }
      case RelocType.TableIndexSleb:
      case RelocType.TableIndexRelSleb:
      case RelocType.TableNumberLeb:
        break; // a table slot or a table number: each module keeps its tables
      default:
        if (relocIsMemoryAddr(e.type)) {
          throw new BundleError(
            `${what}: ${
              relocTypeName(e.type)
            } is not supported (64-bit, TLS and locally-relative addresses)`,
          );
        }
        break; // FUNCTION_OFFSET / SECTION_OFFSET belong to DWARF, which is dropped
    }
  }

  const dataMeta = m.sectionMeta.find((s) => s.section === BinarySection.Data);
  for (const e of relocs.get(BinarySection.Data) ?? []) {
    if (dataMeta === undefined) throw new BundleError(`${what}: reloc.DATA without a data section`);
    sites.entries++;
    const abs = dataMeta.offset + e.offset;
    const seg = m.dataSegments.find((d) =>
      d.dataLoc !== undefined && abs >= d.dataLoc.offset &&
      abs + 4 <= d.dataLoc.offset + d.data.length
    );
    switch (e.type) {
      case RelocType.MemoryAddrI32: {
        if (seg === undefined || seg.dataLoc === undefined) {
          return stale(e, 'no data segment holds that word');
        }
        const offset = abs - seg.dataLoc.offset;
        const want = expectedAddress(e);
        const have = readI32(seg.data, offset);
        if (want !== undefined && have !== want) {
          stale(e, `the word is ${have}, the symbol says ${want}`);
        }
        sites.words.push({ segment: seg, offset });
        break;
      }
      case RelocType.TableIndexI32:
        break; // a table slot stored in memory: each module keeps its tables
      case RelocType.FunctionIndexI32:
      case RelocType.GlobalIndexI32:
        throw new BundleError(
          `${what}: ${
            relocTypeName(e.type)
          } in the data section is not supported (an index stored in memory moves when the bundle renumbers it)`,
        );
      default:
        if (relocIsMemoryAddr(e.type)) {
          throw new BundleError(
            `${what}: ${relocTypeName(e.type)} is not supported in the data section`,
          );
        }
        break;
    }
  }
  // Entries against the global section: our own assembler's `(@reloc data)`
  // on a global's initializer — the bundler moves those globals by NAME
  // below (every marked global joins the address globals).
  sites.entries += (relocs.get(BinarySection.Global) ?? []).length;
  return sites;
}

/** The static data's address range of `m`: every active segment with a constant offset. */
function dataRange(m: Module): [lo: number, hi: number] | undefined {
  let lo = Infinity;
  let hi = 0;
  for (const d of m.dataSegments) {
    if (d.kind !== 'active') continue;
    const base = constOffset(d.offset);
    if (base === undefined) continue;
    lo = Math.min(lo, base);
    hi = Math.max(hi, base + d.data.length);
  }
  return hi > 0 ? [lo, hi] : undefined;
}

/** wasmtk's rule: every `i32.const` inside the static data's address range is an address. */
function guessedSites(m: Module): Sites {
  const sites: Sites = { consts: [], memargs: [], words: [], entries: 0 };
  const range = dataRange(m);
  if (range === undefined) return sites;
  const [lo, hi] = range;
  const d: ExprVisitorDelegate = {
    onConstExpr(e) {
      if (e.value.type === Type.I32 && e.value.value >= lo && e.value.value < hi) {
        sites.consts.push(e);
      }
      return Result.Ok;
    },
  };
  const v = new ExprVisitor(d);
  for (const f of m.functions) v.visitFunc(f);
  return sites;
}

/** Globals whose initializer a `reloc.GLOBAL` entry marks (our assembler's `(@reloc data)`). */
function markedGlobals(m: Module, relocs: Map<BinarySection, RelocEntry[]>): Set<Global> {
  const out = new Set<Global>();
  const entries = relocs.get(BinarySection.Global) ?? [];
  if (entries.length === 0) return out;
  const meta = m.sectionMeta.find((s) => s.section === BinarySection.Global);
  if (meta === undefined) return out;
  for (const e of entries) {
    const abs = meta.offset + e.offset;
    // The entry points at the `i32.const` immediate; the global's `loc` is its
    // type byte, so the immediate is at loc + type(1) + mutability(1) + opcode(1).
    const g = m.globals.find((x) => x.loc !== undefined && x.loc.offset + 3 === abs);
    if (g !== undefined) out.add(g);
  }
  return out;
}

// ---------------------------------------------------------------------------
// One input, prepared: its image, its sites, the globals that move
// ---------------------------------------------------------------------------

interface Prepared {
  input: BundleInput;
  m: Module;
  what: string;
  /** The module's one memory, or none. */
  memory: { limits: Limits; imported: boolean } | undefined;
  base: number;
  pages: number;
  relocation: 'linked' | 'guessed' | 'none';
  sites: Sites;
  addressGlobals: Set<Global>;
  symbolGlobalNames: Map<number, string>;
  dropped: string[];
}

function prepare(input: BundleInput, options: BundleOptions, warnings: string[]): Prepared {
  const m = input.module;
  const what = input.source ?? input.name;

  if (m.types.some((t) => t.kind !== 'func')) {
    throw new BundleError(
      `${what}: struct and array types (GC) are not supported by wasm-bundle yet`,
    );
  }
  const memories: { limits: Limits; imported: boolean }[] = [];
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Memory) {
      memories.push({ limits: imp.memory.limits, imported: true });
    }
  }
  for (const mem of m.memories) memories.push({ limits: mem.limits, imported: false });
  if (memories.length > 1) {
    throw new BundleError(
      `${what}: ${memories.length} memories; a bundle input has one memory or none`,
    );
  }
  const memory = memories[0];
  if (memory !== undefined) {
    if (memory.limits.is64) throw new BundleError(`${what}: a 64-bit memory is not supported`);
    if (memory.limits.isShared) throw new BundleError(`${what}: a shared memory is not supported`);
    if (memory.limits.pageSizeLog2 !== undefined && memory.limits.pageSizeLog2 !== 16) {
      throw new BundleError(`${what}: a custom page size is not supported`);
    }
  }

  const linked = linkingOf(m, what);
  let sites: Sites;
  let relocation: Prepared['relocation'];
  const addressGlobals = new Set<Global>();
  const symbolGlobalNames = new Map<number, string>();
  if (linked !== undefined) {
    relocation = 'linked';
    sites = linkedSites(m, what, linked.linking, linked.relocs);
    for (const sym of linked.linking.symbols) {
      if (sym.kind === SymbolKind.Global && sym.index !== undefined && sym.name !== undefined) {
        symbolGlobalNames.set(sym.index, sym.name);
      }
    }
    for (const g of markedGlobals(m, linked.relocs)) addressGlobals.add(g);
  } else if (memory === undefined) {
    relocation = 'none';
    sites = { consts: [], memargs: [], words: [], entries: 0 };
  } else if (options.unmarked === 'guess') {
    relocation = 'guessed';
    sites = guessedSites(m);
    warnings.push(
      `${what}: no linking section — its addresses are GUESSED (every i32.const inside its static data's ` +
        `range, ${sites.consts.length} of them); a constant that happens to fall in that range moves too. ` +
        'Link with `wasm-ld --emit-relocs`, or mark the addresses with (@reloc data) in the text, for an exact bundle.',
    );
  } else {
    throw new BundleError(
      `${what}: no linking section, so its addresses are not marked and the bundle cannot move its memory exactly. ` +
        'Link with `wasm-ld --emit-relocs` (rustc: -C link-arg=--emit-relocs), mark the addresses with ' +
        '(@reloc data) in the text, or pass --unmarked=guess to relocate by address range with a warning.',
    );
  }

  // The address globals, by every name the module gives them.
  const importedGlobals = m.imports.filter((i) => i.kind === ExternalKind.Global).length;
  const exportedAs = new Map<string, string>();
  for (const ex of m.exports) {
    if (ex.kind === ExternalKind.Global && ex.var.kind === 'name') {
      exportedAs.set(ex.var.name, ex.name);
    }
  }
  m.globals.forEach((g, i) => {
    const names = [
      g.name.replace(/^\$/, ''),
      symbolGlobalNames.get(importedGlobals + i),
      exportedAs.get(g.name),
    ];
    if (names.some((n) => n !== undefined && ADDRESS_GLOBALS.has(n))) addressGlobals.add(g);
  });
  for (const g of addressGlobals) {
    if (g.type !== Type.I32 || constOffset(g.init) === undefined) {
      throw new BundleError(
        `${what}: global ${g.name} holds an address but is not an i32 constant`,
      );
    }
  }

  const dropped = m.customSections.map((c) => c.name).filter((n) => n !== 'name');
  return {
    input,
    m,
    what,
    memory,
    base: 0,
    pages: memory === undefined ? 0 : Number(memory.limits.initial),
    relocation,
    sites,
    addressGlobals,
    symbolGlobalNames,
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Rewriting one input's references into the bundle's names and indices
// ---------------------------------------------------------------------------

interface Renames {
  func: Map<string, string>;
  global: Map<string, string>;
  table: Map<string, string>;
  tag: Map<string, string>;
  typeBase: number;
  dataBase: number;
  elemBase: number;
}

class Rewire implements ExprVisitorDelegate {
  constructor(
    private readonly sp: Spaces,
    private readonly r: Renames,
    private readonly what: string,
  ) {}

  private of(space: 'func' | 'global' | 'table' | 'tag', v: Var): Var {
    const names = space === 'func'
      ? this.sp.funcs
      : space === 'global'
      ? this.sp.globals
      : space === 'table'
      ? this.sp.tables
      : this.sp.tags;
    const old = v.kind === 'name' ? v.name : names[v.value];
    if (old === undefined) {
      throw new BundleError(
        `${this.what}: ${space} ${v.kind === 'index' ? v.value : v.name} is out of range`,
      );
    }
    const to = this.r[space].get(old);
    if (to === undefined) {
      throw new BundleError(`${this.what}: ${space} ${old} has no place in the bundle`);
    }
    return varName(to);
  }
  func(v: Var): Var {
    return this.of('func', v);
  }
  global(v: Var): Var {
    return this.of('global', v);
  }
  table(v: Var): Var {
    return this.of('table', v);
  }
  tag(v: Var): Var {
    return this.of('tag', v);
  }
  type(v: Var): Var {
    const i = indexOfName(this.sp.types, v);
    if (i < 0) {
      throw new BundleError(
        `${this.what}: type ${v.kind === 'name' ? v.name : v.value} is unknown`,
      );
    }
    return varIndex(i + this.r.typeBase);
  }
  data(v: Var): Var {
    const i = indexOfName(this.sp.data, v);
    if (i < 0) {
      throw new BundleError(
        `${this.what}: data segment ${v.kind === 'name' ? v.name : v.value} is unknown`,
      );
    }
    return varIndex(i + this.r.dataBase);
  }
  elem(v: Var): Var {
    const i = indexOfName(this.sp.elems, v);
    if (i < 0) {
      throw new BundleError(
        `${this.what}: element segment ${v.kind === 'name' ? v.name : v.value} is unknown`,
      );
    }
    return varIndex(i + this.r.elemBase);
  }
  heap(h: HeapTypeRef): HeapTypeRef {
    if (h.kind === 'abstract') return h;
    if (h.kind === 'exact') return { ...h, type: this.type(h.type) };
    return this.type(h);
  }
  valueType(t: ValueType): ValueType {
    return isRefValueType(t) ? { ...t, heapType: this.heap(t.heapType) } : t;
  }
  sig(s: FuncSignature): FuncSignature {
    return {
      params: s.params.map((t) => this.valueType(t)),
      results: s.results.map((t) => this.valueType(t)),
    };
  }
  blockResult(t: BlockResult): BlockResult {
    if (t === 'none') return t;
    return Array.isArray(t) ? t.map((x) => this.valueType(x)) : this.valueType(t);
  }

  private carrier(e: {
    type: BlockResult;
    typeIndex?: number;
    params?: { types: ValueType[]; values: Expr[] };
  }): Result {
    const w = e as W<typeof e>;
    w.type = this.blockResult(e.type);
    if (e.typeIndex !== undefined) w.typeIndex = e.typeIndex + this.r.typeBase;
    if (e.params !== undefined) {
      w.params = {
        ...e.params,
        types: e.params.types.map((t) => this.valueType(t)),
      };
    }
    return Result.Ok;
  }
  beginBlockExpr(e: { type: BlockResult; typeIndex?: number }): Result {
    return this.carrier(e);
  }
  beginLoopExpr(e: { type: BlockResult; typeIndex?: number }): Result {
    return this.carrier(e);
  }
  beginIfExpr(e: { type: BlockResult; typeIndex?: number }): Result {
    return this.carrier(e);
  }
  beginTryExpr(e: { type: BlockResult; typeIndex?: number }): Result {
    return this.carrier(e);
  }
  beginTryTableExpr(
    e: { type: BlockResult; typeIndex?: number; catches: { tag?: Var }[] },
  ): Result {
    for (const c of e.catches) if (c.tag !== undefined) (c as W<typeof c>).tag = this.tag(c.tag);
    return this.carrier(e);
  }
  onCatchExpr(_e: unknown, c: { tag?: Var }): Result {
    if (c.tag !== undefined) (c as W<typeof c>).tag = this.tag(c.tag);
    return Result.Ok;
  }
  onThrowExpr(e: { tag: Var }): Result {
    (e as W<typeof e>).tag = this.tag(e.tag);
    return Result.Ok;
  }

  onCallExpr(e: { func: Var }): Result {
    (e as W<typeof e>).func = this.func(e.func);
    return Result.Ok;
  }
  onRefFuncExpr(e: { func: Var }): Result {
    (e as W<typeof e>).func = this.func(e.func);
    return Result.Ok;
  }
  onCallIndirectExpr(e: { table: Var; typeVar?: Var }): Result {
    const w = e as W<typeof e>;
    w.table = this.table(e.table);
    if (e.typeVar !== undefined) w.typeVar = this.type(e.typeVar);
    return Result.Ok;
  }
  onCallRefExpr(e: { sigType: Var }): Result {
    (e as W<typeof e>).sigType = this.type(e.sigType);
    return Result.Ok;
  }
  onGlobalGetExpr(e: { var: Var }): Result {
    (e as W<typeof e>).var = this.global(e.var);
    return Result.Ok;
  }
  onGlobalSetExpr(e: { var: Var }): Result {
    (e as W<typeof e>).var = this.global(e.var);
    return Result.Ok;
  }

  private mem(e: { memidx: Var }): Result {
    (e as W<typeof e>).memidx = varIndex(0);
    return Result.Ok;
  }
  onLoadExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onStoreExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicLoadExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicStoreExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicRmwExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicRmwCmpxchgExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicWaitExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onAtomicNotifyExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onSimdLoadLaneExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onLoadSplatExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onMemorySizeExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onMemoryGrowExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onMemoryFillExpr(e: { memidx: Var }): Result {
    return this.mem(e);
  }
  onMemoryCopyExpr(e: { destMemidx: Var; srcMemidx: Var }): Result {
    const w = e as W<typeof e>;
    w.destMemidx = varIndex(0);
    w.srcMemidx = varIndex(0);
    return Result.Ok;
  }
  onMemoryInitExpr(e: { segment: Var; memidx: Var }): Result {
    const w = e as W<typeof e>;
    w.segment = this.data(e.segment);
    w.memidx = varIndex(0);
    return Result.Ok;
  }
  onDataDropExpr(e: { segment: Var }): Result {
    (e as W<typeof e>).segment = this.data(e.segment);
    return Result.Ok;
  }
  onElemDropExpr(e: { segment: Var }): Result {
    (e as W<typeof e>).segment = this.elem(e.segment);
    return Result.Ok;
  }
  onTableInitExpr(e: { segment: Var; table: Var }): Result {
    const w = e as W<typeof e>;
    w.segment = this.elem(e.segment);
    w.table = this.table(e.table);
    return Result.Ok;
  }
  onTableCopyExpr(e: { destTable: Var; sourceTable: Var }): Result {
    const w = e as W<typeof e>;
    w.destTable = this.table(e.destTable);
    w.sourceTable = this.table(e.sourceTable);
    return Result.Ok;
  }
  private tbl(e: { table: Var }): Result {
    (e as W<typeof e>).table = this.table(e.table);
    return Result.Ok;
  }
  onTableGetExpr(e: { table: Var }): Result {
    return this.tbl(e);
  }
  onTableSetExpr(e: { table: Var }): Result {
    return this.tbl(e);
  }
  onTableGrowExpr(e: { table: Var }): Result {
    return this.tbl(e);
  }
  onTableSizeExpr(e: { table: Var }): Result {
    return this.tbl(e);
  }
  onTableFillExpr(e: { table: Var }): Result {
    return this.tbl(e);
  }

  onSelectExpr(e: { resultType?: ValueType[] }): Result {
    if (e.resultType !== undefined) {
      (e as W<typeof e>).resultType = e.resultType.map((t) => this.valueType(t));
    }
    return Result.Ok;
  }
  onRefNullExpr(e: { refType: HeapTypeRef }): Result {
    (e as W<typeof e>).refType = this.heap(e.refType);
    return Result.Ok;
  }
  onRefTestExpr(e: { heapType: HeapTypeRef }): Result {
    (e as W<typeof e>).heapType = this.heap(e.heapType);
    return Result.Ok;
  }
  onRefCastExpr(e: { heapType: HeapTypeRef }): Result {
    (e as W<typeof e>).heapType = this.heap(e.heapType);
    return Result.Ok;
  }
  onBrOnExpr(e: { from?: { heapType: HeapTypeRef }; to?: { heapType: HeapTypeRef } }): Result {
    const w = e as W<typeof e>;
    if (e.from !== undefined) w.from = { ...e.from, heapType: this.heap(e.from.heapType) };
    if (e.to !== undefined) w.to = { ...e.to, heapType: this.heap(e.to.heapType) };
    return Result.Ok;
  }
  onArrayNewDataExpr(e: { typeVar: Var; dataVar: Var }): Result {
    const w = e as W<typeof e>;
    w.typeVar = this.type(e.typeVar);
    w.dataVar = this.data(e.dataVar);
    return Result.Ok;
  }
  onArrayNewElemExpr(e: { typeVar: Var; elemVar: Var }): Result {
    const w = e as W<typeof e>;
    w.typeVar = this.type(e.typeVar);
    w.elemVar = this.elem(e.elemVar);
    return Result.Ok;
  }
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/** One export an input offers, with the entity's name in the bundle. */
interface Offered {
  input: Prepared;
  name: string;
  kind: ExternalKind;
  target: string;
}

const kindName = (k: ExternalKind): string =>
  k === ExternalKind.Func
    ? 'func'
    : k === ExternalKind.Table
    ? 'table'
    : k === ExternalKind.Memory
    ? 'memory'
    : k === ExternalKind.Global
    ? 'global'
    : 'tag';

/**
 * Bundle `inputs` into one module. The inputs are CONSUMED: their trees are
 * renamed and rewired in place and become the result's. The result is a
 * module as `readForPasses` would give — ready for `writeWasm`, the
 * optimizer, or the interpreter.
 */
export function bundle(
  inputs: BundleInput[],
  options: Partial<BundleOptions> = {},
): { module: WasmModule; report: BundleReport } {
  const opts: BundleOptions = { ...defaults, ...options };
  const log = opts.log;
  if (inputs.length === 0) throw new BundleError('nothing to bundle');
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name)) {
      throw new BundleError(
        `"${input.name}" is not a module name (letters, digits and _; not starting with a digit)`,
      );
    }
    if (seen.has(input.name)) throw new BundleError(`two inputs are named "${input.name}"`);
    seen.add(input.name);
  }

  const warnings: string[] = [];
  const prepared = inputs.map((input) => prepare(input, opts, warnings));

  // The layout: each image at the next page boundary, in input order.
  let pages = 0;
  let maxPages: number | undefined = 0;
  for (const p of prepared) {
    p.base = pages * PAGE;
    pages += p.pages;
    const max = p.memory?.limits.max;
    if (p.memory !== undefined && max === undefined) maxPages = undefined;
    else if (maxPages !== undefined && max !== undefined) maxPages += Number(max);
  }
  if (pages * PAGE > 0xffff_ffff) {
    throw new BundleError(`the images need ${pages} pages, more than a 32-bit memory holds`);
  }

  const out = makeModule();
  out.hasNameSection = prepared.some((p) => p.m.hasNameSection);
  out.hasDataCountSection = prepared.some((p) => p.m.hasDataCountSection);
  out.fidelity = new FidelityTable();

  const used = {
    func: new Set<string>(),
    global: new Set<string>(),
    table: new Set<string>(),
    tag: new Set<string>(),
    type: new Set<string>(),
    data: new Set<string>(),
    elem: new Set<string>(),
  };
  const outMemoryName = '$memory';
  const claim = (space: keyof typeof used, old: string, prefix: string): string => {
    const base = old === '' ? `$${prefix}` : old;
    if (!used[space].has(base)) {
      used[space].add(base);
      return base;
    }
    return unique(used[space], `$${prefix}.${base.replace(/^\$/, '')}`);
  };

  const real = {
    functions: new Set<string>(),
    tables: new Set<string>(),
    memories: new Set<string>([outMemoryName]),
    globals: new Set<string>(),
    tags: new Set<string>(),
    elements: new Set<string>(),
    dataSegments: new Set<string>(),
    types: new Set<string>(),
    labels: new Map<string, ReadonlySet<string>>(),
    localsListed: new Set<string>(),
  };
  let anyLocalsListed = false;
  const isReal = (
    names: ExplicitNames | undefined,
    set: ReadonlySet<string> | undefined,
    n: string,
  ): boolean => n !== '' && (names === undefined || (set !== undefined && set.has(n)));

  // Pass 1: every entity's name in the bundle; imports shared once.
  interface SharedImport {
    name: string;
    sig?: FuncSignature;
    global?: { type: ValueType; mutable: boolean };
    table?: { elemType: ValueType; limits: Limits };
  }
  const shared = new Map<string, SharedImport>();
  const renames = new Map<Prepared, Renames>();
  const crossImports: { p: Prepared; imp: Import; target: Prepared; entity: string }[] = [];
  const offers = new Map<Prepared, Map<string, Offered>>();
  let typeCount = 0;
  let dataCount = 0;
  let elemCount = 0;
  const funcSigOf = (m: Module, f: { typeVar?: Var; sig: FuncSignature }): FuncSignature => {
    if (f.typeVar !== undefined) {
      const t = m.types[indexOfName(m.types.map((x) => x.name), f.typeVar)];
      if (t !== undefined && t.kind === 'func') return t.sig;
    }
    return f.sig;
  };

  for (const p of prepared) {
    const m = p.m;
    const names = m.explicitNames;
    const r: Renames = {
      func: new Map(),
      global: new Map(),
      table: new Map(),
      tag: new Map(),
      typeBase: typeCount,
      dataBase: dataCount,
      elemBase: elemCount,
    };
    renames.set(p, r);
    typeCount += m.types.length;
    dataCount += m.dataSegments.length;
    elemCount += m.elements.length;
    const prefix = p.input.name;
    const byInputName = new Map(prepared.map((x) => [x.input.name, x] as const));

    for (const imp of m.imports) {
      const entity = imp.kind === ExternalKind.Func
        ? imp.func.name
        : imp.kind === ExternalKind.Global
        ? imp.global.name
        : imp.kind === ExternalKind.Table
        ? imp.table.name
        : imp.kind === ExternalKind.Tag
        ? imp.tag.name
        : imp.memory.name;
      const space = imp.kind === ExternalKind.Func
        ? 'func'
        : imp.kind === ExternalKind.Global
        ? 'global'
        : imp.kind === ExternalKind.Table
        ? 'table'
        : imp.kind === ExternalKind.Tag
        ? 'tag'
        : undefined;
      if (imp.kind === ExternalKind.Memory) continue; // the bundle's one memory stands in for it
      const target = byInputName.get(imp.module);
      if (target !== undefined && target !== p) {
        // Linked to another input's export, resolved once every name is known.
        crossImports.push({ p, imp, target, entity });
        continue;
      }
      // The dynamic-linking convention: the host's bases become ours.
      if (
        imp.module === 'env' && imp.kind === ExternalKind.Global && imp.field === '__memory_base'
      ) {
        const name = claim('global', imp.global.name, prefix);
        r.global.set(entity, name);
        out.globals.push({
          name,
          type: Type.I32,
          mutable: false,
          init: region([{ kind: 'const', value: constI32(p.base | 0) } as ConstExpr], unknown()),
        });
        continue;
      }
      if (
        imp.module === 'env' && imp.kind === ExternalKind.Global && imp.field === '__table_base'
      ) {
        const name = claim('global', imp.global.name, prefix);
        r.global.set(entity, name);
        out.globals.push({
          name,
          type: Type.I32,
          mutable: false,
          init: region([{ kind: 'const', value: constI32(0) } as ConstExpr], unknown()),
        });
        continue;
      }
      if (
        imp.module === 'env' && imp.kind === ExternalKind.Table &&
        imp.field === '__indirect_function_table'
      ) {
        const name = claim('table', imp.table.name, prefix);
        r.table.set(entity, name);
        out.tables.push({ name, elemType: imp.table.elemType, limits: imp.table.limits });
        continue;
      }
      const key = `${imp.module}\u0000${imp.field}\u0000${imp.kind}`;
      const have = shared.get(key);
      if (have !== undefined) {
        if (
          imp.kind === ExternalKind.Func && have.sig !== undefined &&
          !sigEquals(funcSigOf(m, imp.func), have.sig)
        ) {
          throw new BundleError(
            `${p.what}: import "${imp.module}" "${imp.field}" has a different type than another input's`,
          );
        }
        if (
          imp.kind === ExternalKind.Global && have.global !== undefined &&
          (!valueTypeEquals(imp.global.type, have.global.type) ||
            imp.global.mutable !== have.global.mutable)
        ) {
          throw new BundleError(
            `${p.what}: import "${imp.module}" "${imp.field}" has a different type than another input's`,
          );
        }
        r[space!].set(entity, have.name);
        continue;
      }
      const name = claim(space!, entity, prefix);
      r[space!].set(entity, name);
      const rec: SharedImport = { name };
      if (imp.kind === ExternalKind.Func) rec.sig = funcSigOf(m, imp.func);
      if (imp.kind === ExternalKind.Global) {
        rec.global = { type: imp.global.type, mutable: imp.global.mutable };
      }
      if (imp.kind === ExternalKind.Table) {
        rec.table = { elemType: imp.table.elemType, limits: imp.table.limits };
      }
      shared.set(key, rec);
      if (imp.kind === ExternalKind.Func) {
        imp.func.name = name;
        if (isReal(names, names?.functions, entity)) real.functions.add(name);
      } else if (imp.kind === ExternalKind.Global) {
        imp.global.name = name;
        if (isReal(names, names?.globals, entity)) real.globals.add(name);
      } else if (imp.kind === ExternalKind.Table) {
        imp.table.name = name;
        if (isReal(names, names?.tables, entity)) real.tables.add(name);
      } else if (imp.kind === ExternalKind.Tag) {
        imp.tag.name = name;
        if (isReal(names, names?.tags, entity)) real.tags.add(name);
      }
      out.imports.push(imp);
    }

    const rename = <T extends { name: string }>(
      items: T[],
      space: keyof typeof used,
      map: Map<string, string> | undefined,
      set: keyof ExplicitNames,
    ): void => {
      for (const it of items) {
        const old = it.name;
        const name = claim(space, old, prefix);
        map?.set(old, name);
        if (isReal(names, names?.[set] as ReadonlySet<string> | undefined, old)) {
          (real[set as keyof typeof real] as Set<string>).add(name);
        }
        it.name = name;
      }
    };
    // Functions first: labels and listed locals are keyed by their names.
    for (const f of m.functions) {
      const old = f.name;
      const name = claim('func', old, prefix);
      r.func.set(old, name);
      if (isReal(names, names?.functions, old)) real.functions.add(name);
      const labels = names?.labels.get(old);
      if (labels !== undefined && labels.size > 0) real.labels.set(name, labels);
      if (names === undefined || names.localsListed === undefined) {
        anyLocalsListed = true;
        real.localsListed.add(name);
      } else if (names.localsListed !== null) {
        if (names.localsListed.has(old)) {
          anyLocalsListed = true;
          real.localsListed.add(name);
        }
      }
      f.name = name;
    }
    rename(m.globals, 'global', r.global, 'globals');
    rename(m.tables, 'table', r.table, 'tables');
    rename(m.tags, 'tag', r.tag, 'tags');
    rename(m.types, 'type', undefined, 'types');
    rename(m.dataSegments, 'data', undefined, 'dataSegments');
    rename(m.elements, 'elem', undefined, 'elements');

    // What this input offers to the others and to the world.
    const offered = new Map<string, Offered>();
    for (const ex of m.exports) {
      if (ex.kind === ExternalKind.Memory) {
        offered.set(ex.name, { input: p, name: ex.name, kind: ex.kind, target: outMemoryName });
        continue;
      }
      const space = ex.kind === ExternalKind.Func
        ? 'func'
        : ex.kind === ExternalKind.Global
        ? 'global'
        : ex.kind === ExternalKind.Table
        ? 'table'
        : 'tag';
      const sp = spacesOf(m);
      // `spacesOf` sees the names AFTER the rename of defined entities and
      // of shared imports — but an import bound to another input is still
      // its old name; resolve through the map in either case.
      const v = ex.var;
      const old = v.kind === 'name'
        ? v.name
        : sp[`${space}s` as 'funcs' | 'globals' | 'tables' | 'tags'][v.value];
      if (old === undefined) throw new BundleError(`${p.what}: export "${ex.name}" names nothing`);
      const target = r[space].get(old) ?? old;
      offered.set(ex.name, { input: p, name: ex.name, kind: ex.kind, target });
    }
    offers.set(p, offered);
  }

  // Pass 2: imports from another input, now that its names are final.
  for (const { p, imp, target, entity } of crossImports) {
    const r = renames.get(p)!;
    const offered = offers.get(target)!.get(imp.field);
    if (offered === undefined || offered.kind !== imp.kind) {
      throw new BundleError(
        `${p.what}: imports "${imp.module}" "${imp.field}" (${
          kindName(imp.kind)
        }), which input "${target.input.name}" does not export`,
      );
    }
    if (imp.kind === ExternalKind.Func) {
      const f = target.m.functions.find((x) => x.name === offered.target) ??
        target.m.imports.find((x): x is Extract<Import, { kind: ExternalKind.Func }> =>
          x.kind === ExternalKind.Func && x.func.name === offered.target
        )?.func;
      if (f !== undefined && !sigEquals(funcSigOf(p.m, imp.func), funcSigOf(target.m, f))) {
        throw new BundleError(
          `${p.what}: imports "${imp.module}" "${imp.field}" with a type other than its definition's`,
        );
      }
      r.func.set(entity, offered.target);
    } else if (imp.kind === ExternalKind.Global) r.global.set(entity, offered.target);
    else if (imp.kind === ExternalKind.Table) r.table.set(entity, offered.target);
    else if (imp.kind === ExternalKind.Tag) r.tag.set(entity, offered.target);
  }

  // Pass 3: rewire every reference, move every address, and take the entities.
  const reports: InputReport[] = [];
  const starts: string[] = [];
  for (const p of prepared) {
    const m = p.m;
    const r = renames.get(p)!;
    const rw = new Rewire(spacesOf(m), r, p.what);
    const visitor = new ExprVisitor(rw);
    const region_ = (x: { children: Expr[] } | undefined) => {
      if (x !== undefined) visitor.visitExprList(x.children);
    };
    let moved = 0;

    for (const t of m.types) {
      if (t.kind === 'func') (t as W<typeof t>).sig = rw.sig(t.sig);
      out.types.push(t);
    }
    for (const imp of m.imports) {
      if (imp.kind === ExternalKind.Func) {
        if (imp.func.typeVar !== undefined) imp.func.typeVar = rw.type(imp.func.typeVar);
        imp.func.sig = rw.sig(imp.func.sig);
      } else if (imp.kind === ExternalKind.Tag) {
        if (imp.tag.typeVar !== undefined) imp.tag.typeVar = rw.type(imp.tag.typeVar);
        imp.tag.sig = rw.sig(imp.tag.sig);
      } else if (imp.kind === ExternalKind.Global) imp.global.type = rw.valueType(imp.global.type);
      else if (imp.kind === ExternalKind.Table) {
        imp.table.elemType = rw.valueType(imp.table.elemType);
      }
    }
    for (const f of m.functions) {
      if (f.typeVar !== undefined) f.typeVar = rw.type(f.typeVar);
      f.sig = rw.sig(f.sig);
      for (const l of f.locals) l.type = rw.valueType(l.type);
      visitor.visitFunc(f);
      out.functions.push(f);
    }
    for (const g of m.globals) {
      g.type = rw.valueType(g.type);
      region_(g.init);
      if (p.addressGlobals.has(g) && g.init !== undefined) {
        shiftConst(g.init.children[0] as ConstExpr, p.base, p.what);
        moved++;
      }
      out.globals.push(g);
    }
    for (const t of m.tables) {
      t.elemType = rw.valueType(t.elemType);
      region_(t.init);
      out.tables.push(t);
    }
    for (const t of m.tags) {
      if (t.typeVar !== undefined) t.typeVar = rw.type(t.typeVar);
      t.sig = rw.sig(t.sig);
      out.tags.push(t);
    }
    for (const seg of m.elements) {
      seg.elemType = rw.valueType(seg.elemType);
      if (seg.kind === 'active') seg.tableVar = rw.table(seg.tableVar);
      region_(seg.offset);
      for (const e of seg.elemExprs) region_(e);
      out.elements.push(seg);
    }
    for (const seg of m.dataSegments) {
      seg.memoryVar = varIndex(0);
      if (seg.kind === 'active' && seg.offset !== undefined) {
        const c = seg.offset.children[0];
        if (
          seg.offset.children.length === 1 && c !== undefined && c.kind === 'const' &&
          c.value.type === Type.I32
        ) {
          shiftConst(c, p.base, p.what);
          moved++;
        } else region_(seg.offset); // `global.get __memory_base`: the global moves
      }
      delete seg.dataLoc;
      delete seg.relocs;
      out.dataSegments.push(seg);
    }
    for (const c of p.sites.consts) {
      shiftConst(c, p.base, p.what);
      delete (c as W<ConstExpr>).reloc;
      moved++;
    }
    for (const n of p.sites.memargs) {
      (n as W<MemArgExpr>).offset = n.offset + BigInt(p.base);
      moved++;
    }
    for (const { segment, offset } of p.sites.words) {
      writeI32(segment.data, offset, (readI32(segment.data, offset) + p.base) | 0);
      moved++;
    }
    if (m.start !== undefined) {
      const s = rw.func(m.start);
      if (s.kind === 'name') starts.push(s.name);
    }

    reports.push({
      name: p.input.name,
      base: p.base,
      pages: p.pages,
      relocation: p.relocation,
      entries: p.sites.entries,
      moved,
      exports: [...offers.get(p)!.keys()],
      dropped: p.dropped,
    });
  }

  // The one memory.
  if (prepared.some((p) => p.memory !== undefined)) {
    const limits: Limits = { initial: BigInt(pages), isShared: false, is64: false };
    if (maxPages !== undefined) limits.max = BigInt(maxPages);
    const mem: Memory = { name: outMemoryName, limits };
    out.memories.push(mem);
  }

  // Exports: the memory's names collapse into one set; the rest under the policy.
  const conflicts: ConflictReport[] = [];
  const exportsOut: BundleReport['exports'] = [];
  const memoryNames = new Set<string>();
  const byName = new Map<string, Offered[]>();
  for (const p of prepared) {
    for (const o of offers.get(p)!.values()) {
      if (o.kind === ExternalKind.Memory) {
        memoryNames.add(o.name);
        continue;
      }
      byName.set(o.name, [...(byName.get(o.name) ?? []), o]);
    }
  }
  if (out.memories.length > 0) memoryNames.add('memory');
  const push = (name: string, o: Offered): void => {
    out.exports.push({ name, kind: o.kind, var: varName(o.target) });
    exportsOut.push({ name, kind: kindName(o.kind), from: o.input.input.name });
  };
  const refused: string[] = [];
  for (const [name, list] of byName) {
    if (list.length === 1) {
      push(name, list[0]!);
      continue;
    }
    // `_start`: the chosen input's stays; the others' are prefixed.
    if (name === '_start' && opts.start !== undefined) {
      const chosen = list.find((o) => o.input.input.name === opts.start);
      if (chosen === undefined) {
        throw new BundleError(`--start names "${opts.start}", which exports no _start`);
      }
      push(name, chosen);
      for (const o of list) if (o !== chosen) push(`${o.input.input.name}_${name}`, o);
      conflicts.push({ name, inputs: list.map((o) => o.input.input.name), resolution: 'prefix' });
      continue;
    }
    const inputs = list.map((o) => o.input.input.name);
    switch (opts.onConflict) {
      case 'refuse':
        refused.push(`"${name}" (${inputs.join(', ')})`);
        break;
      case 'alias': {
        const unnamed = inputs.filter((n) => !opts.named.has(n));
        if (unnamed.length > 0) {
          throw new BundleError(
            `--on-conflict=alias needs an alias for every module in a conflict; "${name}" involves ${
              unnamed.join(', ')
            } ` +
              'with none (--alias file.wasm=name)',
          );
        }
        for (const o of list) push(`${o.input.input.name}_${name}`, o);
        conflicts.push({ name, inputs, resolution: 'alias' });
        break;
      }
      case 'prefix':
        for (const o of list) push(`${o.input.input.name}_${name}`, o);
        conflicts.push({ name, inputs, resolution: 'prefix' });
        break;
      case 'exclude':
        conflicts.push({ name, inputs, resolution: 'exclude' });
        break;
    }
  }
  if (refused.length > 0) {
    throw new BundleError(
      `${refused.length} export name${refused.length === 1 ? '' : 's'} clash: ${
        refused.join('; ')
      }. ` +
        'Pass --on-conflict=prefix (each becomes <module>_<name>), =alias (with --alias), or =exclude.',
    );
  }
  for (
    const name of [...memoryNames].sort((a, b) =>
      a === 'memory' ? -1 : b === 'memory' ? 1 : a.localeCompare(b)
    )
  ) {
    const o: Offered = {
      input: prepared[0]!,
      name,
      kind: ExternalKind.Memory,
      target: outMemoryName,
    };
    out.exports.push({ name, kind: ExternalKind.Memory, var: varName(outMemoryName) });
    exportsOut.push({ name, kind: 'memory', from: '(bundle)' });
    void o;
  }

  // Start functions: one stays; several run in input order from one of ours.
  if (starts.length === 1) out.start = varName(starts[0]!);
  else if (starts.length > 1) {
    const name = unique(used.func, '$__wasm_bundle_start');
    const typeName = unique(used.type, '$__wasm_bundle_start_type');
    const typeIndex = out.types.length;
    out.types.push({ kind: 'func', name: typeName, sig: { params: [], results: [] } });
    const body = starts.map((s) => makeCall(varName(s), [], None) as unknown as Expr);
    const f: Func = {
      name,
      typeVar: varIndex(typeIndex),
      sig: { params: [], results: [] },
      locals: [],
      body: region(body, unknown()),
    };
    out.functions.push(f);
    out.start = varName(name);
  }

  out.explicitNames = {
    functions: real.functions,
    localsListed: anyLocalsListed ? real.localsListed : null,
    labels: real.labels,
    types: real.types,
    tables: real.tables,
    memories: real.memories,
    globals: real.globals,
    elements: real.elements,
    dataSegments: real.dataSegments,
    tags: real.tags,
    fields: new Map(),
  };

  const report: BundleReport = {
    inputs: reports,
    conflicts,
    exports: exportsOut,
    memory: maxPages === undefined ? { pages } : { pages, maxPages },
    warnings,
  };
  if (log !== undefined) {
    for (const r of reports) {
      const how = r.relocation === 'linked'
        ? `${r.entries} relocations verified, ${r.moved} sites moved`
        : r.relocation === 'guessed'
        ? `${r.moved} sites moved by GUESS`
        : 'no memory';
      log(
        `  ${r.name}: ${r.pages} pages at ${r.base} — ${how}; ${r.exports.length} export${
          r.exports.length === 1 ? '' : 's'
        }`,
      );
      const dwarf = r.dropped.filter((n) =>
        n.startsWith('.debug_') || n.startsWith('reloc..debug_')
      );
      if (dwarf.length > 0) log(`    dropped ${dwarf.length} DWARF sections (not relocated)`);
    }
    for (const c of conflicts) {
      log(`  conflict "${c.name}" (${c.inputs.join(', ')}): ${c.resolution}`);
    }
    for (const w of warnings) log(`  ⚠️  ${w}`);
    log(
      `  memory: ${pages} page${pages === 1 ? '' : 's'}${
        maxPages === undefined ? '' : ` (max ${maxPages})`
      }; ` +
        `${out.exports.length} export${out.exports.length === 1 ? '' : 's'}`,
    );
  }
  return { module: out, report };
}

function unknown(): Location {
  return { filename: '', line: 0, column: 0, offset: 0 };
}

// ---------------------------------------------------------------------------
// Files and the CLI
// ---------------------------------------------------------------------------

/** Options for {@link wasmBundle}: {@link BundleOptions} plus the files. */
export interface WasmBundleOptions extends BundleOptions {
  /** Names for inputs, by path or basename (`--alias a.wasm=m`). */
  aliases: ReadonlyMap<string, string>;
  /** Write WAT text instead of a binary (`-S`). */
  emitText: boolean;
}

/** The module name a file gets when none is given: its basename, `[^A-Za-z0-9_]` → `_`. */
export function moduleNameOf(path: string): string {
  const stem = basename(path).replace(/\.(wasm|wat)$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(stem) ? `_${stem}` : stem === '' ? 'module' : stem;
}

/** Read each file (`.wasm` or `.wat`), bundle, and return the bytes (or text) and the report. */
export async function wasmBundle(
  paths: string[],
  options: Partial<WasmBundleOptions> = {},
): Promise<{ output: Uint8Array | string; report: BundleReport }> {
  const aliases = options.aliases ?? new Map<string, string>();
  const named = new Set<string>();
  const inputs: BundleInput[] = [];
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    const module = path.endsWith('.wat')
      ? readWat(new TextDecoder().decode(bytes), path)
      : readForPasses(bytes, path);
    const alias = aliases.get(path) ?? aliases.get(basename(path));
    const name = alias ?? moduleNameOf(path);
    if (alias !== undefined) named.add(name);
    inputs.push({ name, module, source: path });
  }
  const { module, report } = bundle(inputs, { ...options, named });
  const out = writeWasm(module);
  return { output: options.emitText ? writeWat(readForPasses(out)) : out, report };
}

function usage(): void {
  console.error('Usage: wasm-bundle <input.wasm|.wat>... [options]');
  console.error('  -o <file>                  Output file (default: bundle.wasm; - for stdout)');
  console.error(
    '  --on-conflict=MODE         Same export name in two inputs: prefix | alias | exclude',
  );
  console.error('                             (default: refuse, listing them)');
  console.error(
    '  --alias a.wasm=m,b.wasm=n  Name inputs (the prefix on conflict; what others import from)',
  );
  console.error(
    '  --unmarked=guess           Relocate an input without relocations by address range (warned)',
  );
  console.error('  --start=NAME               Whose _start stays _start (the others are prefixed)');
  console.error('  -q, --quiet                No report lines');
  console.error('  -S                         Emit WAT text');
}

/** The CLI: parses `args` and runs {@link wasmBundle}. */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const inputs: string[] = [];
  const options: Partial<WasmBundleOptions> = {};
  let output = 'bundle.wasm';
  const aliases = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-o') output = args[++i] ?? output;
    else if (a.startsWith('--on-conflict=')) {
      const v = a.slice(14);
      if (v !== 'prefix' && v !== 'alias' && v !== 'exclude' && v !== 'refuse') {
        console.error(`wasm-bundle: --on-conflict is prefix, alias or exclude, not "${v}"`);
        process.exit(1);
      }
      options.onConflict = v;
    } else if (a.startsWith('--alias=') || a === '--alias') {
      const spec = a === '--alias' ? args[++i] ?? '' : a.slice(8);
      for (const pair of spec.split(',').filter(Boolean)) {
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          console.error(`wasm-bundle: --alias takes file=name pairs, not "${pair}"`);
          process.exit(1);
        }
        aliases.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    } else if (a.startsWith('--unmarked=')) {
      const v = a.slice(11);
      if (v !== 'refuse' && v !== 'guess') {
        console.error(`wasm-bundle: --unmarked is refuse or guess, not "${v}"`);
        process.exit(1);
      }
      options.unmarked = v;
    } else if (a.startsWith('--start=')) options.start = a.slice(8);
    else if (a === '-q' || a === '--quiet') options.log = undefined;
    else if (a === '-S') options.emitText = true;
    else if (a.startsWith('-')) {
      console.error(`wasm-bundle: unknown option ${a}`);
      usage();
      process.exit(1);
    } else inputs.push(a);
  }
  if (inputs.length === 0) {
    usage();
    process.exit(1);
  }
  options.aliases = aliases;
  if (!('log' in options)) options.log = (line) => console.log(line);
  if (options.log !== undefined) {
    console.log(`wasm-bundle: ${inputs.length} module${inputs.length === 1 ? '' : 's'}`);
  }
  let result: Awaited<ReturnType<typeof wasmBundle>>;
  try {
    result = await wasmBundle(inputs, options);
  } catch (e) {
    console.error(
      `wasm-bundle: ${e instanceof WatInputError || e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  if (output === '-') {
    if (typeof result.output === 'string') console.log(result.output);
    else process.stdout.write(result.output);
    return;
  }
  await writeFile(output, result.output);
  if (options.log !== undefined) {
    console.log(
      typeof result.output === 'string'
        ? `Wrote WAT: ${output}`
        : `Wrote WASM: ${output} (${result.output.byteLength} bytes)`,
    );
  }
}
