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
export enum BinarySection {
  Custom = 0,
  Type = 1,
  Import = 2,
  Function = 3,
  Table = 4,
  Memory = 5,
  Global = 6,
  Export = 7,
  Start = 8,
  Elem = 9,
  Code = 10,
  Data = 11,
  DataCount = 12,
  Tag = 13,
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
export enum NameSectionSubsection {
  Module = 0,
  Function = 1,
  Local = 2,
  Label = 3,
  Type = 4,
  Table = 5,
  Memory = 6,
  Global = 7,
  ElemSegment = 8,
  DataSegment = 9,
  Field = 10,
  Tag = 11,
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
export enum ExternalKind {
  Func = 0,
  Table = 1,
  Memory = 2,
  Global = 3,
  Tag = 4,
}
