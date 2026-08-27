// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/result.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Result type for fallible operations — mirrors the `Result` enum from wabt's
 * C++ source. Prefer returning `Result` over throwing for recoverable parse
 * and validation errors.
 */

/** Outcome of a fallible wabt operation. */
export enum Result {
  /** The operation succeeded. */
  Ok = 0,
  /** The operation failed; caller should inspect the error list. */
  Error = 1,
}

/** Returns true if {@link r} indicates success. */
export function succeeded(r: Result): boolean {
  return r === Result.Ok;
}

/** Returns true if {@link r} indicates failure. */
export function failed(r: Result): boolean {
  return r === Result.Error;
}

/**
 * Combines two results: returns {@link Result.Error} if either input is an
 * error, otherwise {@link Result.Ok}. Mirrors the C++ `operator|`.
 */
export function combineResults(a: Result, b: Result): Result {
  return a === Result.Error || b === Result.Error ? Result.Error : Result.Ok;
}
