// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/stream.h, src/stream.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import {
  encodeU32Leb128,
  encodeU64Leb128,
  encodeS32Leb128,
  encodeS64Leb128,
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

  get offset(): number { return this._pos; }

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

  /** Reserve 5 bytes for a u32 LEB128 and return the position for back-patching. */
  reserveU32Leb(): number {
    const pos = this._pos;
    this.grow(MAX_U32_LEB128_BYTES);
    this._pos += MAX_U32_LEB128_BYTES;
    return pos;
  }

  /** Back-patch a 5-byte fixed-width u32 LEB128 at the given position. */
  patchU32Leb(pos: number, value: number): void {
    let v = value >>> 0;
    for (let i = 0; i < MAX_U32_LEB128_BYTES; i++) {
      this._buf[pos + i] = (v & 0x7f) | (i < MAX_U32_LEB128_BYTES - 1 ? 0x80 : 0x00);
      v >>>= 7;
    }
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
