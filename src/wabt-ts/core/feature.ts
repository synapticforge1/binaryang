// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/feature.h, include/wabt/feature.def
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WebAssembly feature flags — controls which proposals are enabled during
 * parsing, validation, and code generation.
 */

/** Snapshot of which WebAssembly proposals are enabled. */
export interface Features {
  /** Exception handling proposal. */
  exceptions: boolean;
  /** Mutable imported globals. On by default in the spec. */
  mutableGlobals: boolean;
  /** Saturating float-to-int conversion operators. */
  satFloatToInt: boolean;
  /** Sign-extension operators. */
  signExtension: boolean;
  /** SIMD (128-bit vector) instructions. */
  simd: boolean;
  /** Threads and atomics proposal. */
  threads: boolean;
  /** Typed function references proposal. */
  functionReferences: boolean;
  /** Multiple return values and block types. */
  multiValue: boolean;
  /** Tail-call optimization proposal. */
  tailCall: boolean;
  /** Bulk memory operations (memory.copy, memory.fill, table.copy, etc.). */
  bulkMemory: boolean;
  /** Reference types proposal (externref, table.get/set, etc.). */
  referenceTypes: boolean;
  /** Annotations in the text format. */
  annotations: boolean;
  /** Code metadata custom section support. */
  codeMetadata: boolean;
  /** Garbage collection proposal (struct, array, i31ref). */
  gc: boolean;
  /** 64-bit memory addressing (memory64 proposal). */
  memory64: boolean;
  /** Multiple memories proposal. */
  multiMemory: boolean;
  /** Extended constant expressions proposal. */
  extendedConst: boolean;
  /** Relaxed SIMD proposal. */
  relaxedSimd: boolean;
  /** Custom page sizes proposal. */
  customPageSizes: boolean;
  /**
   * Compact imports proposal.
   *
   * ⚠️ **DECLARED BUT NOT IMPLEMENTED — setting this changes nothing.** No code
   * reads this field, and the binary reader decodes only the standard import
   * kinds, so a module using import kind `0x7f` is refused whatever this says.
   *
   * Kept rather than removed because `Features` is public surface and dropping
   * a field is a breaking change; the reader now names the proposal in its
   * diagnostic instead of reporting "unknown import kind: 127". The proposal is
   * experimental — V8 needs `--experimental-wasm-compact-imports` to load such
   * a module at all — so implementing it is not planned.
   *
   * 🔑 **A feature flag is not an implementation.** This one was counted as
   * support until the spec-testsuite harness produced 58 confusing failures
   * that traced back to it. If it is ever implemented, delete this note.
   */
  compactImports: boolean;
  /**
   * Wide arithmetic proposal — `i64.add128`, `i64.sub128`, `i64.mul_wide_s/u`.
   *
   * ✅ Implemented in wabt-ts: decoded, validated, written, and byte-identical
   * on a round trip.
   *
   * ⚠️ NOT implemented in binaryen-ts's binary reader, which refuses the
   * sub-opcodes loudly (`unsupported bulk-memory/table opcode: 0xFC 0x13`).
   * That asymmetry is deliberate for now and tracked in `cmem/open-work.md`.
   */
  wideArithmetic: boolean;
}

/**
 * Returns a {@link Features} object with the defaults that match the wabt
 * tool defaults (proposals that are part of the ratified WebAssembly spec
 * are enabled; experimental proposals are disabled).
 */
export function defaultFeatures(): Features {
  return {
    exceptions: false,
    mutableGlobals: true,
    satFloatToInt: true,
    signExtension: true,
    simd: true,
    threads: false,
    functionReferences: false,
    multiValue: true,
    tailCall: false,
    bulkMemory: true,
    referenceTypes: true,
    annotations: false,
    codeMetadata: false,
    gc: false,
    memory64: false,
    multiMemory: false,
    extendedConst: false,
    relaxedSimd: false,
    customPageSizes: false,
    compactImports: false,
    wideArithmetic: false,
  };
}

/** Returns a {@link Features} object with every proposal enabled. */
export function allFeatures(): Features {
  return {
    exceptions: true,
    mutableGlobals: true,
    satFloatToInt: true,
    signExtension: true,
    simd: true,
    threads: true,
    functionReferences: true,
    multiValue: true,
    tailCall: true,
    bulkMemory: true,
    referenceTypes: true,
    annotations: true,
    codeMetadata: true,
    gc: true,
    memory64: true,
    multiMemory: true,
    extendedConst: true,
    relaxedSimd: true,
    customPageSizes: true,
    compactImports: true,
    wideArithmetic: true,
  };
}
