// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/binary-reader-nop.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * A no-op binary-reader delegate.
 *
 * In the C++ wabt, `binary-reader-nop.h` provides a delegate that ignores
 * every callback — useful as a base class for selective overrides or as a
 * validation pass that only checks structure without building an IR.
 *
 * In the TypeScript port the equivalent is {@link NopDelegate} from
 * `src/ir/expr-visitor.ts`. This module re-exports it under the name
 * `BinaryReaderNop` to preserve source-naming compatibility.
 */

export { NopDelegate as BinaryReaderNop } from '../ir/expr-visitor.ts';
