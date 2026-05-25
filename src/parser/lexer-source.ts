// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/lexer-source.h, src/lexer-source.cc
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Source buffer abstraction for the WAT/WAST lexer.
 *
 * Wraps a `Uint8Array` (or string decoded to bytes) and provides
 * random-access read + position tracking used by {@link WastLexer}.
 */

// Codec singletons reused across all sources. Both are stateless and safe to
// share — avoids per-call allocation in sliceText, which is on the lexer hot
// path for every identifier, name, and literal token.
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** A named source buffer suitable for lexing. */
export class LexerSource {
  /** Raw source bytes. */
  readonly data: Uint8Array;
  /** Current read position (byte index into data). */
  private _offset = 0;

  constructor(data: Uint8Array | string, readonly filename = '<input>') {
    if (typeof data === 'string') {
      this.data = TEXT_ENCODER.encode(data);
    } else {
      this.data = data;
    }
  }

  /** Total byte length of the source. */
  get size(): number { return this.data.length; }

  /** Current read position. */
  get offset(): number { return this._offset; }

  /** Peek at the byte at `offset` without moving the position. Returns -1 at EOF. */
  peek(offset = this._offset): number {
    return offset < this.data.length ? (this.data[offset] ?? -1) : -1;
  }

  /** Read the byte at the current position and advance. Returns -1 at EOF. */
  read(): number {
    if (this._offset >= this.data.length) return -1;
    return this.data[this._offset++] ?? -1;
  }

  /** Seek to an absolute byte offset. */
  seek(offset: number): void {
    this._offset = Math.min(offset, this.data.length);
  }

  /** Return the slice of source bytes in `[start, end)`. */
  slice(start: number, end: number): Uint8Array {
    return this.data.subarray(start, end);
  }

  /** Decode `[start, end)` as UTF-8 text. */
  sliceText(start: number, end: number): string {
    return TEXT_DECODER.decode(this.data.subarray(start, end));
  }

  /** Return true when all bytes have been consumed. */
  get isEof(): boolean { return this._offset >= this.data.length; }
}
