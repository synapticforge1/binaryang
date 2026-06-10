// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/leb128.h, src/leb128.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * LEB128 (Little Endian Base 128) encoding and decoding for WebAssembly
 * binary format integers.
 *
 * WebAssembly uses unsigned LEB128 for most index types and counts, and
 * signed LEB128 for i32/i64 constant initializers.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum bytes needed to encode any 32-bit LEB128 value. */
export const MAX_U32_LEB128_BYTES = 5;

/** Maximum bytes needed to encode any 64-bit unsigned LEB128 value. */
export const MAX_U64_LEB128_BYTES = 10;

/** Maximum bytes needed to encode any 32-bit signed LEB128 value. */
export const MAX_S32_LEB128_BYTES = 5;

/** Maximum bytes needed to encode any 64-bit signed LEB128 value. */
export const MAX_S64_LEB128_BYTES = 10;

// ---------------------------------------------------------------------------
// Unsigned LEB128
// ---------------------------------------------------------------------------

/**
 * Encodes a non-negative integer as unsigned LEB128.
 *
 * @param value - The value to encode. Must be a non-negative safe integer
 *   (≤ 2^53 − 1) or a BigInt for 64-bit values — see {@link encodeU64Leb128}.
 */
export function encodeU32Leb128(value: number): Uint8Array {
  const buf: number[] = [];
  let v = value >>> 0; // treat as unsigned 32-bit
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    buf.push(byte);
  } while (v !== 0);
  return new Uint8Array(buf);
}

/**
 * Encodes a 64-bit unsigned integer as unsigned LEB128.
 *
 * @param value - The value to encode as a BigInt.
 */
export function encodeU64Leb128(value: bigint): Uint8Array {
  const buf: number[] = [];
  let v = BigInt.asUintN(64, value);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    buf.push(byte);
  } while (v !== 0n);
  return new Uint8Array(buf);
}

/**
 * Decodes an unsigned LEB128-encoded 32-bit integer from {@link bytes} starting
 * at {@link offset}.
 *
 * @returns A tuple of `[value, bytesConsumed]`.
 * @throws {RangeError} if the encoding is truncated or exceeds 32 bits.
 */
export function decodeU32Leb128(bytes: Uint8Array, offset = 0): [value: number, bytesRead: number] {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    i++;
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) {
      // For the 5th byte (shift will become 35), only the bottom 4 bits are
      // valid for a 32-bit value (bits 28-31). Bits 4-6 of the 5th byte would
      // land in bits 32-34 — that's overflow.
      if (shift === 35 && (byte & 0x70) !== 0) throw new RangeError('LEB128 u32 overflow');
      return [result >>> 0, i - offset];
    }
    if (shift >= 35) throw new RangeError('LEB128 u32 overflow');
  }
  throw new RangeError('LEB128 sequence is truncated');
}

/**
 * Decodes an unsigned LEB128-encoded 64-bit integer from {@link bytes} starting
 * at {@link offset}.
 *
 * @returns A tuple of `[value, bytesConsumed]`.
 * @throws {RangeError} if the encoding is truncated or exceeds 64 bits.
 */
export function decodeU64Leb128(
  bytes: Uint8Array,
  offset = 0,
): [value: bigint, bytesRead: number] {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    i++;
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) {
      // 10th byte (shift === 70): only bit 0 (→ value bit 63) is valid; bits
      // 1-6 land at positions 64-69 and would be silently truncated by
      // asUintN(64) — reject instead of accepting an over-long encoding.
      if (shift === 70n && (byte & 0x7e) !== 0) throw new RangeError('LEB128 u64 overflow');
      return [BigInt.asUintN(64, result), i - offset];
    }
    if (shift >= 70n) throw new RangeError('LEB128 u64 overflow');
  }
  throw new RangeError('LEB128 sequence is truncated');
}

// ---------------------------------------------------------------------------
// Signed LEB128
// ---------------------------------------------------------------------------

/**
 * Encodes a signed 32-bit integer as signed LEB128.
 *
 * @param value - The value to encode. Must be in the range [−2^31, 2^31 − 1].
 */
export function encodeS32Leb128(value: number): Uint8Array {
  const buf: number[] = [];
  let v = value | 0; // signed 32-bit
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7; // arithmetic shift
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    buf.push(byte);
  }
  return new Uint8Array(buf);
}

/**
 * Encodes a signed 64-bit integer as signed LEB128.
 *
 * @param value - The value to encode as a BigInt in the range [−2^63, 2^63 − 1].
 */
export function encodeS64Leb128(value: bigint): Uint8Array {
  const buf: number[] = [];
  let v = BigInt.asIntN(64, value);
  let more = true;
  while (more) {
    let byte = Number(v & 0x7fn);
    v >>= 7n; // arithmetic shift
    if ((v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    buf.push(byte);
  }
  return new Uint8Array(buf);
}

/**
 * Decodes a signed LEB128-encoded 32-bit integer from {@link bytes} starting
 * at {@link offset}.
 *
 * @returns A tuple of `[value, bytesConsumed]`.
 * @throws {RangeError} if the encoding is truncated or exceeds 32 bits.
 */
export function decodeS32Leb128(bytes: Uint8Array, offset = 0): [value: number, bytesRead: number] {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    i++;
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) {
      // 5th byte (shift === 35): bits 4-6 land at value positions 32-34 and
      // must be a sign-extension of bit 31 (byte bit 3). Valid 5th bytes have
      // bits 3-6 all-0 (non-negative) or all-1 (negative); anything else is an
      // out-of-range encoding that `result | 0` would silently truncate.
      if (shift === 35 && (byte & 0x78) !== 0 && (byte & 0x78) !== 0x78) {
        throw new RangeError('LEB128 s32 overflow');
      }
      if (shift < 32 && (byte & 0x40) !== 0) {
        result |= ~0 << shift; // sign-extend
      }
      return [result | 0, i - offset];
    }
    if (shift >= 35) throw new RangeError('LEB128 s32 overflow');
  }
  throw new RangeError('LEB128 sequence is truncated');
}

/**
 * Decodes a signed LEB128-encoded 64-bit integer from {@link bytes} starting
 * at {@link offset}.
 *
 * @returns A tuple of `[value, bytesConsumed]`.
 * @throws {RangeError} if the encoding is truncated or exceeds 64 bits.
 */
export function decodeS64Leb128(
  bytes: Uint8Array,
  offset = 0,
): [value: bigint, bytesRead: number] {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    i++;
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if ((byte & 0x80) === 0) {
      // 10th byte (shift === 70): bit 0 is value bit 63 (sign); bits 1-6 land
      // at positions 64-69 and must sign-extend it. Valid 10th bytes are 0x00
      // (non-negative) or 0x7f (negative); anything else is an over-range
      // encoding that `asIntN(64)` would silently truncate.
      if (shift === 70n && (byte & 0x7f) !== 0 && (byte & 0x7f) !== 0x7f) {
        throw new RangeError('LEB128 s64 overflow');
      }
      if (shift < 64n && (byte & 0x40) !== 0) {
        result |= ~0n << shift; // sign-extend
      }
      return [BigInt.asIntN(64, result), i - offset];
    }
    if (shift >= 70n) throw new RangeError('LEB128 s64 overflow');
  }
  throw new RangeError('LEB128 sequence is truncated');
}
