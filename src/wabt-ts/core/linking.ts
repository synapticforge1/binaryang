// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module wabt-ts/core/linking
 *
 * The tool-conventions Linking format (open-work 24, `wasm-bundle`): the
 * `linking` custom section — a symbol table and the data segments' names —
 * and the `reloc.*` custom sections, one per section that holds relocatable
 * immediates, each entry naming a byte offset in that section, a symbol and
 * what kind of immediate sits there. `wasm-ld --emit-relocs` writes them into
 * a LINKED module (rustc, zig, clang through `wasm-ld`); our binary writer
 * writes them from `(@reloc …)` annotations in the text; `wasm-bundle` reads
 * them to relocate every marked address EXACTLY when it moves a module's
 * memory image.
 *
 * Reference: https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md
 * (version 2). Only what the bundler consumes is decoded: the symbol table,
 * the segment info and the relocation entries. `WASM_INIT_FUNCS` and
 * `WASM_COMDAT_INFO` are recorded as opaque subsections and never acted on.
 *
 * ⚠️ A relocation's `offset` is relative to the START OF THE TARGET SECTION'S
 * PAYLOAD (after its id and size), and it points at the IMMEDIATE, not the
 * opcode. It is valid only against the bytes the section had when the
 * entries were written: a tool that rewrites the code (our writer re-encodes
 * the padded LEBs `wasm-ld` leaves at relocatable sites; `wasm-opt` rewrites
 * everything) leaves the entries STALE. That is why the bundler ties every
 * entry to an instruction node as the module is read and verifies it against
 * the code before it trusts it (wasmtk's measurement, 2026-10-06: TinyGo runs
 * `wasm-opt` after linking and 0 of 48 address sites were still correct).
 *
 * @license MIT
 */

import { decodeS32Leb128, decodeU32Leb128, encodeS32Leb128, encodeU32Leb128 } from './leb128.ts';

// ---------------------------------------------------------------------------
// Constants of the format
// ---------------------------------------------------------------------------

/** The `linking` section version this reads and writes. */
export const LINKING_VERSION = 2;

/** Names of the two sections: `linking` and the `reloc.` prefix. */
export const LINKING_SECTION_NAME = 'linking';
export const RELOC_SECTION_PREFIX = 'reloc.';

/** Subsection ids of the `linking` section. */
export const enum LinkingSubsection {
  SegmentInfo = 5,
  InitFuncs = 6,
  ComdatInfo = 7,
  SymbolTable = 8,
}

/** Symbol kinds (`SYMTAB_*`). */
export const enum SymbolKind {
  Function = 0,
  Data = 1,
  Global = 2,
  Section = 3,
  Tag = 4,
  Table = 5,
}

/** Symbol flags (`WASM_SYM_*`). */
export const SYM_BINDING_WEAK = 0x1;
export const SYM_BINDING_LOCAL = 0x2;
export const SYM_VISIBILITY_HIDDEN = 0x4;
export const SYM_UNDEFINED = 0x10;
export const SYM_EXPORTED = 0x20;
export const SYM_EXPLICIT_NAME = 0x40;
export const SYM_NO_STRIP = 0x80;
export const SYM_TLS = 0x100;
export const SYM_ABSOLUTE = 0x200;

/** Relocation types (`R_WASM_*`), by their numbers in the format. */
export const enum RelocType {
  FunctionIndexLeb = 0,
  TableIndexSleb = 1,
  TableIndexI32 = 2,
  MemoryAddrLeb = 3,
  MemoryAddrSleb = 4,
  MemoryAddrI32 = 5,
  TypeIndexLeb = 6,
  GlobalIndexLeb = 7,
  FunctionOffsetI32 = 8,
  SectionOffsetI32 = 9,
  TagIndexLeb = 10,
  MemoryAddrRelSleb = 11,
  TableIndexRelSleb = 12,
  GlobalIndexI32 = 13,
  MemoryAddrLeb64 = 14,
  MemoryAddrSleb64 = 15,
  MemoryAddrI64 = 16,
  MemoryAddrRelSleb64 = 17,
  TableIndexSleb64 = 18,
  TableIndexI64 = 19,
  TableNumberLeb = 20,
  MemoryAddrTlsSleb = 21,
  FunctionOffsetI64 = 22,
  MemoryAddrLocrelI32 = 23,
  TableIndexRelSleb64 = 24,
  MemoryAddrTlsSleb64 = 25,
  FunctionIndexI32 = 26,
}

const RELOC_NAMES: Record<number, string> = {
  0: 'R_WASM_FUNCTION_INDEX_LEB',
  1: 'R_WASM_TABLE_INDEX_SLEB',
  2: 'R_WASM_TABLE_INDEX_I32',
  3: 'R_WASM_MEMORY_ADDR_LEB',
  4: 'R_WASM_MEMORY_ADDR_SLEB',
  5: 'R_WASM_MEMORY_ADDR_I32',
  6: 'R_WASM_TYPE_INDEX_LEB',
  7: 'R_WASM_GLOBAL_INDEX_LEB',
  8: 'R_WASM_FUNCTION_OFFSET_I32',
  9: 'R_WASM_SECTION_OFFSET_I32',
  10: 'R_WASM_TAG_INDEX_LEB',
  11: 'R_WASM_MEMORY_ADDR_REL_SLEB',
  12: 'R_WASM_TABLE_INDEX_REL_SLEB',
  13: 'R_WASM_GLOBAL_INDEX_I32',
  14: 'R_WASM_MEMORY_ADDR_LEB64',
  15: 'R_WASM_MEMORY_ADDR_SLEB64',
  16: 'R_WASM_MEMORY_ADDR_I64',
  17: 'R_WASM_MEMORY_ADDR_REL_SLEB64',
  18: 'R_WASM_TABLE_INDEX_SLEB64',
  19: 'R_WASM_TABLE_INDEX_I64',
  20: 'R_WASM_TABLE_NUMBER_LEB',
  21: 'R_WASM_MEMORY_ADDR_TLS_SLEB',
  22: 'R_WASM_FUNCTION_OFFSET_I64',
  23: 'R_WASM_MEMORY_ADDR_LOCREL_I32',
  24: 'R_WASM_TABLE_INDEX_REL_SLEB64',
  25: 'R_WASM_MEMORY_ADDR_TLS_SLEB64',
  26: 'R_WASM_FUNCTION_INDEX_I32',
};

/** `R_WASM_…` for a type number, or the number itself for one this file does not know. */
export function relocTypeName(t: number): string {
  return RELOC_NAMES[t] ?? `R_WASM_type_${t}`;
}

/** Whether entries of type `t` carry an addend (the `MEMORY_ADDR_*` and `*_OFFSET_*` types). */
export function relocHasAddend(t: number): boolean {
  switch (t) {
    case RelocType.MemoryAddrLeb:
    case RelocType.MemoryAddrSleb:
    case RelocType.MemoryAddrI32:
    case RelocType.FunctionOffsetI32:
    case RelocType.SectionOffsetI32:
    case RelocType.MemoryAddrRelSleb:
    case RelocType.MemoryAddrLeb64:
    case RelocType.MemoryAddrSleb64:
    case RelocType.MemoryAddrI64:
    case RelocType.MemoryAddrRelSleb64:
    case RelocType.MemoryAddrTlsSleb:
    case RelocType.FunctionOffsetI64:
    case RelocType.MemoryAddrLocrelI32:
    case RelocType.MemoryAddrTlsSleb64:
      return true;
    default:
      return false;
  }
}

/** Whether `t` names a MEMORY ADDRESS — the entries a relocation of the memory image must patch. */
export function relocIsMemoryAddr(t: number): boolean {
  switch (t) {
    case RelocType.MemoryAddrLeb:
    case RelocType.MemoryAddrSleb:
    case RelocType.MemoryAddrI32:
    case RelocType.MemoryAddrRelSleb:
    case RelocType.MemoryAddrLeb64:
    case RelocType.MemoryAddrSleb64:
    case RelocType.MemoryAddrI64:
    case RelocType.MemoryAddrRelSleb64:
    case RelocType.MemoryAddrTlsSleb:
    case RelocType.MemoryAddrLocrelI32:
    case RelocType.MemoryAddrTlsSleb64:
      return true;
    default:
      return false;
  }
}

/** Whether `t` is RELATIVE to `__memory_base` (no patch when the base global moves with the image). */
export function relocIsMemoryRel(t: number): boolean {
  return t === RelocType.MemoryAddrRelSleb || t === RelocType.MemoryAddrRelSleb64;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One symbol of the symbol table. `index` is the function / global / tag / table index, or the section index. */
export interface LinkingSymbol {
  kind: SymbolKind;
  flags: number;
  /** Absent on a data symbol and on an undefined one without an explicit name. */
  name?: string;
  /** Function, global, tag, table: its index in the module. Section: the section's index. */
  index?: number;
  /** A DEFINED data symbol: which segment, where in it, how long. */
  segment?: number;
  offset?: number;
  size?: number;
}

/** One data segment's entry of the `WASM_SEGMENT_INFO` subsection. */
export interface SegmentInfo {
  name: string;
  alignmentLog2: number;
  flags: number;
}

/** The `linking` section, decoded. */
export interface LinkingSection {
  version: number;
  symbols: LinkingSymbol[];
  segments: SegmentInfo[];
  /** `WASM_INIT_FUNCS` and `WASM_COMDAT_INFO`, kept as bytes. */
  other: { id: number; payload: Uint8Array }[];
}

/** One relocation entry. `offset` is relative to the target section's payload. */
export interface RelocEntry {
  type: RelocType;
  offset: number;
  /** A symbol index — except for `TYPE_INDEX_LEB`, where it is the type index itself. */
  index: number;
  addend: number;
}

/** A `reloc.*` section, decoded: which section it relocates (by index among all sections) and its entries. */
export interface RelocSection {
  /** The relocated section's index in the file (customs counted). */
  section: number;
  entries: RelocEntry[];
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Thrown when a `linking` or `reloc.*` payload is malformed. */
export class LinkingFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkingFormatError';
  }
}

class Cursor {
  pos = 0;
  constructor(readonly bytes: Uint8Array, readonly what: string) {}

  u8(): number {
    if (this.pos >= this.bytes.length) this.fail('unexpected end');
    return this.bytes[this.pos++]!;
  }
  u32(): number {
    if (this.pos >= this.bytes.length) this.fail('unexpected end');
    const [v, n] = decodeU32Leb128(this.bytes, this.pos);
    this.pos += n;
    if (this.pos > this.bytes.length) this.fail('unexpected end');
    return v;
  }
  s32(): number {
    if (this.pos >= this.bytes.length) this.fail('unexpected end');
    const [v, n] = decodeS32Leb128(this.bytes, this.pos);
    this.pos += n;
    if (this.pos > this.bytes.length) this.fail('unexpected end');
    return v;
  }
  name(): string {
    const len = this.u32();
    if (this.pos + len > this.bytes.length) this.fail('name runs past the end');
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  take(len: number): Uint8Array {
    if (this.pos + len > this.bytes.length) this.fail('subsection runs past the end');
    const b = this.bytes.slice(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }
  get done(): boolean {
    return this.pos >= this.bytes.length;
  }
  fail(msg: string): never {
    throw new LinkingFormatError(`${this.what}: ${msg} (at payload offset ${this.pos})`);
  }
}

/** Decode a `linking` section's payload (everything after the section's name). */
export function decodeLinkingSection(payload: Uint8Array): LinkingSection {
  const c = new Cursor(payload, 'linking section');
  const version = c.u32();
  if (version !== LINKING_VERSION) {
    throw new LinkingFormatError(
      `linking section: version ${version}; this reader knows version ${LINKING_VERSION}`,
    );
  }
  const out: LinkingSection = { version, symbols: [], segments: [], other: [] };
  while (!c.done) {
    const id = c.u8();
    const len = c.u32();
    const sub = new Cursor(c.take(len), `linking subsection ${id}`);
    switch (id) {
      case LinkingSubsection.SegmentInfo: {
        const count = sub.u32();
        for (let i = 0; i < count; i++) {
          out.segments.push({ name: sub.name(), alignmentLog2: sub.u32(), flags: sub.u32() });
        }
        break;
      }
      case LinkingSubsection.SymbolTable: {
        const count = sub.u32();
        for (let i = 0; i < count; i++) out.symbols.push(decodeSymbol(sub));
        break;
      }
      default:
        out.other.push({ id, payload: sub.bytes });
        break;
    }
  }
  return out;
}

function decodeSymbol(c: Cursor): LinkingSymbol {
  const kind = c.u8() as SymbolKind;
  const flags = c.u32();
  const undefined_ = (flags & SYM_UNDEFINED) !== 0;
  switch (kind) {
    case SymbolKind.Function:
    case SymbolKind.Global:
    case SymbolKind.Tag:
    case SymbolKind.Table: {
      const index = c.u32();
      const named = !undefined_ || (flags & SYM_EXPLICIT_NAME) !== 0;
      return named ? { kind, flags, index, name: c.name() } : { kind, flags, index };
    }
    case SymbolKind.Data: {
      const name = c.name();
      if (undefined_) return { kind, flags, name };
      return { kind, flags, name, segment: c.u32(), offset: c.u32(), size: c.u32() };
    }
    case SymbolKind.Section:
      return { kind, flags, index: c.u32() };
    default:
      return c.fail(`unknown symbol kind ${kind}`);
  }
}

/** Decode a `reloc.*` section's payload (everything after the section's name). */
export function decodeRelocSection(payload: Uint8Array, sectionName: string): RelocSection {
  const c = new Cursor(payload, sectionName);
  const section = c.u32();
  const count = c.u32();
  const entries: RelocEntry[] = [];
  for (let i = 0; i < count; i++) {
    const type = c.u8() as RelocType;
    const offset = c.u32();
    const index = c.u32();
    const addend = relocHasAddend(type) ? c.s32() : 0;
    entries.push({ type, offset, index, addend });
  }
  return { section, entries };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

class Out {
  private parts: Uint8Array[] = [];
  private len = 0;
  u8(v: number): void {
    this.bytes(Uint8Array.of(v & 0xff));
  }
  u32(v: number): void {
    this.bytes(encodeU32Leb128(v));
  }
  s32(v: number): void {
    this.bytes(encodeS32Leb128(v));
  }
  name(s: string): void {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    this.bytes(b);
  }
  bytes(b: Uint8Array): void {
    this.parts.push(b);
    this.len += b.length;
  }
  take(): Uint8Array {
    const out = new Uint8Array(this.len);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** Encode a `linking` section's payload (the part after the section's name). */
export function encodeLinkingSection(
  symbols: readonly LinkingSymbol[],
  segments: readonly SegmentInfo[] = [],
): Uint8Array {
  const o = new Out();
  o.u32(LINKING_VERSION);
  if (segments.length > 0) {
    const s = new Out();
    s.u32(segments.length);
    for (const seg of segments) {
      s.name(seg.name);
      s.u32(seg.alignmentLog2);
      s.u32(seg.flags);
    }
    const b = s.take();
    o.u8(LinkingSubsection.SegmentInfo);
    o.u32(b.length);
    o.bytes(b);
  }
  if (symbols.length > 0) {
    const s = new Out();
    s.u32(symbols.length);
    for (const sym of symbols) encodeSymbol(s, sym);
    const b = s.take();
    o.u8(LinkingSubsection.SymbolTable);
    o.u32(b.length);
    o.bytes(b);
  }
  return o.take();
}

function encodeSymbol(o: Out, sym: LinkingSymbol): void {
  o.u8(sym.kind);
  o.u32(sym.flags);
  const undefined_ = (sym.flags & SYM_UNDEFINED) !== 0;
  switch (sym.kind) {
    case SymbolKind.Function:
    case SymbolKind.Global:
    case SymbolKind.Tag:
    case SymbolKind.Table: {
      o.u32(sym.index ?? 0);
      const named = !undefined_ || (sym.flags & SYM_EXPLICIT_NAME) !== 0;
      if (named) o.name(sym.name ?? '');
      break;
    }
    case SymbolKind.Data: {
      o.name(sym.name ?? '');
      if (!undefined_) {
        o.u32(sym.segment ?? 0);
        o.u32(sym.offset ?? 0);
        o.u32(sym.size ?? 0);
      }
      break;
    }
    case SymbolKind.Section:
      o.u32(sym.index ?? 0);
      break;
  }
}

/** Encode a `reloc.*` section's payload (the part after the section's name). */
export function encodeRelocSection(section: number, entries: readonly RelocEntry[]): Uint8Array {
  const o = new Out();
  o.u32(section);
  o.u32(entries.length);
  for (const e of entries) {
    o.u8(e.type);
    o.u32(e.offset);
    o.u32(e.index);
    if (relocHasAddend(e.type)) o.s32(e.addend);
  }
  return o.take();
}

// ---------------------------------------------------------------------------
// Section indices of a binary — what a `reloc.*` section's `section` names
// ---------------------------------------------------------------------------

/**
 * Every section of `bytes`, in file order, with its index (what a `reloc.*`
 * section's `section` field counts — customs included), its id, its name for
 * a custom section, and where its payload begins.
 */
export function listSections(
  bytes: Uint8Array,
): { index: number; id: number; name?: string; payloadStart: number; payloadEnd: number }[] {
  const out: {
    index: number;
    id: number;
    name?: string;
    payloadStart: number;
    payloadEnd: number;
  }[] = [];
  let pos = 8;
  let index = 0;
  while (pos < bytes.length) {
    const id = bytes[pos]!;
    const [size, n] = decodeU32Leb128(bytes, pos + 1);
    const payloadStart = pos + 1 + n;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.length) break;
    if (id === 0) {
      const [len, m] = decodeU32Leb128(bytes, payloadStart);
      const name = new TextDecoder().decode(
        bytes.subarray(payloadStart + m, payloadStart + m + len),
      );
      out.push({ index, id, name, payloadStart, payloadEnd });
    } else {
      out.push({ index, id, payloadStart, payloadEnd });
    }
    pos = payloadEnd;
    index++;
  }
  return out;
}
