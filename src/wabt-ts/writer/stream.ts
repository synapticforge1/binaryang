// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/stream.h, src/stream.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import {
  encodeS32Leb128,
  encodeS64Leb128,
  encodeU32Leb128,
  encodeU64Leb128,
  MAX_U32_LEB128_BYTES,
} from '../core/leb128.ts';

// UTF-8 encoder reused across all writeName calls. TextEncoder is stateless,
// so a single module-level instance is safe and avoids reallocating per call.
const TEXT_ENCODER = new TextEncoder();

/**
 * Growable in-memory byte buffer for binary output.
 *
 * `reserveU32Leb` + `patchU32Leb` are used to back-patch section sizes after
 * the section body has been written.
 */
export class MemoryStream {
  private _buf: Uint8Array;
  private _pos = 0;

  constructor(initialCapacity = 256) {
    this._buf = new Uint8Array(initialCapacity);
  }

  get offset(): number {
    return this._pos;
  }

  private grow(needed: number): void {
    const required = this._pos + needed;
    if (required <= this._buf.length) return;
    let cap = this._buf.length * 2;
    if (cap < required) cap = required + 256;
    const next = new Uint8Array(cap);
    next.set(this._buf.subarray(0, this._pos));
    this._buf = next;
  }

  writeU8(byte: number): void {
    this.grow(1);
    this._buf[this._pos++] = byte & 0xff;
  }

  writeU32Le(value: number): void {
    this.grow(4);
    const v = value >>> 0;
    this._buf[this._pos++] = v & 0xff;
    this._buf[this._pos++] = (v >>> 8) & 0xff;
    this._buf[this._pos++] = (v >>> 16) & 0xff;
    this._buf[this._pos++] = (v >>> 24) & 0xff;
  }

  writeBytes(data: Uint8Array): void {
    this.grow(data.length);
    this._buf.set(data, this._pos);
    this._pos += data.length;
  }

  writeU32Leb(value: number): void {
    this.writeBytes(encodeU32Leb128(value));
  }

  writeS32Leb(value: number): void {
    this.writeBytes(encodeS32Leb128(value));
  }

  writeU64Leb(value: bigint): void {
    this.writeBytes(encodeU64Leb128(value));
  }

  writeS64Leb(value: bigint): void {
    this.writeBytes(encodeS64Leb128(value));
  }

  writeF32Bits(bits: number): void {
    this.writeU32Le(bits >>> 0);
  }

  writeF64Bits(bits: bigint): void {
    this.grow(8);
    let v = BigInt.asUintN(64, bits);
    for (let i = 0; i < 8; i++) {
      this._buf[this._pos++] = Number(v & 0xffn);
      v >>= 8n;
    }
  }

  writeV128(bytes: Uint8Array): void {
    this.grow(16);
    const len = bytes.length < 16 ? bytes.length : 16;
    for (let i = 0; i < len; i++) this._buf[this._pos++] = bytes[i]!;
    for (let i = len; i < 16; i++) this._buf[this._pos++] = 0;
  }

  writeName(s: string): void {
    const encoded = TEXT_ENCODER.encode(s);
    this.writeU32Leb(encoded.length);
    this.writeBytes(encoded);
  }

  /**
   * Reserve room for a u32 LEB128 whose value is not known yet -- a section or
   * function-body size -- and return the position to hand back to
   * `patchU32Leb`.
   *
   * INTENT: this reserves the MAXIMUM width (5 bytes) and `patchU32Leb` then
   * collapses it to the minimal encoding. The pair is therefore strictly
   * LIFO-scoped: everything written between the reserve and its patch is the
   * body being measured, and the patch MOVES that body. Do not hold an offset
   * taken after a `reserveU32Leb` across its `patchU32Leb` -- it will be stale.
   * Offsets taken BEFORE the reserve are safe, which is why nesting works
   * (a function body patches before the code section that contains it).
   */
  reserveU32Leb(): number {
    const pos = this._pos;
    this.grow(MAX_U32_LEB128_BYTES);
    this._pos += MAX_U32_LEB128_BYTES;
    return pos;
  }

  /**
   * Back-patch the reservation at `pos` with `value`, encoded MINIMALLY, and
   * close the unused bytes by shifting the body left.
   *
   * This used to write a fixed-width 5-byte LEB and leave the padding in
   * place. That is legal -- 5 is the maximum width for a u32, so engines
   * accept it -- but it made every section header 4 bytes larger than needed,
   * inflating every binary the writer produced and making it impossible to
   * reproduce a minimally-encoded input byte-for-byte. Upstream wabt
   * canonicalises by default (`canonicalize_lebs = true`, which computes the
   * real length and `MoveData`s the body); this is the same thing, reserving
   * the maximum up front instead of guessing and growing.
   */
  patchU32Leb(pos: number, value: number): void {
    const encoded = encodeU32Leb128(value);
    const gap = MAX_U32_LEB128_BYTES - encoded.length;
    if (gap > 0) {
      // Slide the measured body down over the bytes the size did not need.
      this._buf.copyWithin(pos + encoded.length, pos + MAX_U32_LEB128_BYTES, this._pos);
      this._pos -= gap;
    }
    this._buf.set(encoded, pos);
  }

  /** Write a sub-section: reserve size, call writer, patch size. */
  writeSection(sectionId: number, writer: () => void): void {
    this.writeU8(sectionId);
    const sizePos = this.reserveU32Leb();
    const start = this._pos;
    writer();
    this.patchU32Leb(sizePos, this._pos - start);
  }

  toUint8Array(): Uint8Array {
    return this._buf.slice(0, this._pos);
  }
}
