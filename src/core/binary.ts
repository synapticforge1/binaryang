// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WebAssembly binary format constants: magic bytes, version, section IDs,
 * limit flags, and custom section name strings.
 */

// ---------------------------------------------------------------------------
// Module header
// ---------------------------------------------------------------------------

/** WebAssembly binary magic number (`\0asm`). */
export const WASM_MAGIC = 0x6d736100;

/** WebAssembly binary format version (currently 1). */
export const WASM_VERSION = 1;

/** Binary layer for a standard module. */
export const BINARY_LAYER_MODULE = 0;

/** Binary layer for a component (component model proposal). */
export const BINARY_LAYER_COMPONENT = 1;

// ---------------------------------------------------------------------------
// Memory / table limits flags
// ---------------------------------------------------------------------------

/** Limits flag: maximum is present. */
export const LIMITS_HAS_MAX_FLAG = 0x1;

/** Limits flag: memory is shared (threads proposal). */
export const LIMITS_IS_SHARED_FLAG = 0x2;

/** Limits flag: memory uses 64-bit addressing (memory64 proposal). */
export const LIMITS_IS_64_FLAG = 0x4;

/** Limits flag: memory uses a custom page size (custom-page-sizes proposal). */
export const LIMITS_HAS_CUSTOM_PAGE_SIZE_FLAG = 0x8;

// ---------------------------------------------------------------------------
// Section IDs
// ---------------------------------------------------------------------------

/** Section type identifier as it appears in the binary format. */
export const BinarySection = {
  Custom: 0,
  Type: 1,
  Import: 2,
  Function: 3,
  Table: 4,
  Memory: 5,
  Global: 6,
  Export: 7,
  Start: 8,
  Elem: 9,
  Code: 10,
  Data: 11,
  DataCount: 12,
  Tag: 13,
} as const;
/** One of {@link BinarySection}'s values. */
export type BinarySection = (typeof BinarySection)[keyof typeof BinarySection];
/** Each member as a type (`BinarySection.Custom`), as when BinarySection was an `enum`. */
export declare namespace BinarySection {
  type Custom = typeof BinarySection.Custom;
  type Type = typeof BinarySection.Type;
  type Import = typeof BinarySection.Import;
  type Function = typeof BinarySection.Function;
  type Table = typeof BinarySection.Table;
  type Memory = typeof BinarySection.Memory;
  type Global = typeof BinarySection.Global;
  type Export = typeof BinarySection.Export;
  type Start = typeof BinarySection.Start;
  type Elem = typeof BinarySection.Elem;
  type Code = typeof BinarySection.Code;
  type Data = typeof BinarySection.Data;
  type DataCount = typeof BinarySection.DataCount;
  type Tag = typeof BinarySection.Tag;
}

/**
 * Position of a section in the ONE order a module may list them in.
 *
 * The order is NOT the numeric id order: the tag section is id 13 but sits
 * between memory and global, and the data-count section is id 12 but sits
 * between elem and code. A reader that compared ids numerically would accept a
 * module with its sections in an order no producer may emit, and reject a
 * legal one. Custom sections may appear anywhere and repeat, so they have no
 * rank; `sectionOrderRank` returns -1 for them and for an unknown id.
 *
 * `writeBinaryIr` emits the sections in exactly this order.
 */
const SECTION_ORDER: readonly BinarySection[] = [
  BinarySection.Type,
  BinarySection.Import,
  BinarySection.Function,
  BinarySection.Table,
  BinarySection.Memory,
  BinarySection.Tag,
  BinarySection.Global,
  BinarySection.Export,
  BinarySection.Start,
  BinarySection.Elem,
  BinarySection.DataCount,
  BinarySection.Code,
  BinarySection.Data,
];

/**
 * The rank of `s` in {@link SECTION_ORDER}, or -1 for a custom section or an
 * id that is not a section at all.
 */
export function sectionOrderRank(s: number): number {
  return SECTION_ORDER.indexOf(s as BinarySection);
}

/** Total number of known non-custom section types. */
export const NUM_BINARY_SECTIONS = 14;

/** Returns the name of a {@link BinarySection} as a string. */
export function binarySectionName(s: BinarySection): string {
  switch (s) {
    case BinarySection.Custom:
      return 'custom';
    case BinarySection.Type:
      return 'type';
    case BinarySection.Import:
      return 'import';
    case BinarySection.Function:
      return 'function';
    case BinarySection.Table:
      return 'table';
    case BinarySection.Memory:
      return 'memory';
    case BinarySection.Global:
      return 'global';
    case BinarySection.Export:
      return 'export';
    case BinarySection.Start:
      return 'start';
    case BinarySection.Elem:
      return 'elem';
    case BinarySection.Code:
      return 'code';
    case BinarySection.Data:
      return 'data';
    case BinarySection.DataCount:
      return 'data count';
    case BinarySection.Tag:
      return 'tag';
  }
}

// ---------------------------------------------------------------------------
// Name section subsection IDs
// ---------------------------------------------------------------------------

/** Subsection type within the `name` custom section. */
export const NameSectionSubsection = {
  Module: 0,
  Function: 1,
  Local: 2,
  Label: 3,
  Type: 4,
  Table: 5,
  Memory: 6,
  Global: 7,
  ElemSegment: 8,
  DataSegment: 9,
  Field: 10,
  Tag: 11,
} as const;
/** One of {@link NameSectionSubsection}'s values. */
export type NameSectionSubsection =
  (typeof NameSectionSubsection)[keyof typeof NameSectionSubsection];
/** Each member as a type (`NameSectionSubsection.Module`), as when NameSectionSubsection was an `enum`. */
export declare namespace NameSectionSubsection {
  type Module = typeof NameSectionSubsection.Module;
  type Function = typeof NameSectionSubsection.Function;
  type Local = typeof NameSectionSubsection.Local;
  type Label = typeof NameSectionSubsection.Label;
  type Type = typeof NameSectionSubsection.Type;
  type Table = typeof NameSectionSubsection.Table;
  type Memory = typeof NameSectionSubsection.Memory;
  type Global = typeof NameSectionSubsection.Global;
  type ElemSegment = typeof NameSectionSubsection.ElemSegment;
  type DataSegment = typeof NameSectionSubsection.DataSegment;
  type Field = typeof NameSectionSubsection.Field;
  type Tag = typeof NameSectionSubsection.Tag;
}

// ---------------------------------------------------------------------------
// Well-known custom section names
// ---------------------------------------------------------------------------

/** Name of the name custom section. */
export const CUSTOM_SECTION_NAME_NAME = 'name';

/** Name prefix for relocation custom sections. */
export const CUSTOM_SECTION_NAME_RELOC = 'reloc';

/** Name of the linking metadata custom section. */
export const CUSTOM_SECTION_NAME_LINKING = 'linking';

/** Name of the target features custom section (used by LLVM toolchain). */
export const CUSTOM_SECTION_NAME_TARGET_FEATURES = 'target_features';

/** Name of the dylink custom section (v1). */
export const CUSTOM_SECTION_NAME_DYLINK = 'dylink';

/** Name of the dylink custom section (v2). */
export const CUSTOM_SECTION_NAME_DYLINK0 = 'dylink.0';

/** Name prefix for code metadata custom sections. */
export const CUSTOM_SECTION_NAME_CODE_METADATA = 'metadata.code.';

// ---------------------------------------------------------------------------
// External kind IDs (import/export descriptor types)
// ---------------------------------------------------------------------------

/** External kind as encoded in import and export entries. */
export const ExternalKind = {
  Func: 0,
  Table: 1,
  Memory: 2,
  Global: 3,
  Tag: 4,
} as const;
/** One of {@link ExternalKind}'s values. */
export type ExternalKind = (typeof ExternalKind)[keyof typeof ExternalKind];
/** Each member as a type (`ExternalKind.Func`), as when ExternalKind was an `enum`. */
export declare namespace ExternalKind {
  type Func = typeof ExternalKind.Func;
  type Table = typeof ExternalKind.Table;
  type Memory = typeof ExternalKind.Memory;
  type Global = typeof ExternalKind.Global;
  type Tag = typeof ExternalKind.Tag;
}

/**
 * Import kind `0x20` — an EXACT function import (custom descriptors): `func`
 * with bit 5 set, reserved for exactness. An import only: an export section
 * using it is malformed.
 */
export const IMPORT_KIND_EXACT_FUNC = 0x20;

/** The text format's keyword for an external kind: `func`, `table`, `memory`, `global`, `tag`. */
export function externalKindKeyword(
  kind: ExternalKind,
): 'func' | 'table' | 'memory' | 'global' | 'tag' {
  switch (kind) {
    case ExternalKind.Func:
      return 'func';
    case ExternalKind.Table:
      return 'table';
    case ExternalKind.Memory:
      return 'memory';
    case ExternalKind.Global:
      return 'global';
    case ExternalKind.Tag:
      return 'tag';
  }
}
