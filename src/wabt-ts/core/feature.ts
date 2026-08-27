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
  /** Compact imports proposal. */
  compactImports: boolean;
  /** Wide arithmetic proposal. */
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
