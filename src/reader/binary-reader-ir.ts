// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-reader-ir.h, src/binary-reader-ir.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Re-exports the `readBinaryIr` entry point from `binary-reader.ts`.
 *
 * In the C++ wabt, `binary-reader-ir.cc` wires together the low-level
 * `BinaryReader` with an IR-building delegate. In the TypeScript port both
 * concerns live in a single file; this module preserves the original source
 * naming for import-path compatibility.
 */

export { readBinaryIr } from './binary-reader.ts';
export type { ReadBinaryOptions } from './binary-reader.ts';
