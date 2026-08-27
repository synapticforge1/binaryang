// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/literal.h, src/literal.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Literal parsing and printing for WebAssembly text format values.
 *
 * Handles integer, float, and NaN bit-pattern literals in WAT syntax,
 * including hex floats (`0x1.8p+1`) and NaN payloads (`nan:0x200000`).
 */

import { Result } from './result.ts';

// ---------------------------------------------------------------------------
// Literal type tag (used by the lexer to classify token content)
// ---------------------------------------------------------------------------

/** Category of a literal token produced by the lexer. */
export enum LiteralType {
  /** Decimal integer literal (e.g. `42`). */
  Int = 'int',
  /** Hexadecimal integer literal (e.g. `0x2a`). */
  HexInt = 'hexint',
  /** Decimal float literal (e.g. `3.14`). */
  Float = 'float',
  /** Hexadecimal float literal (e.g. `0x1.8p+1`). */
  HexFloat = 'hexfloat',
  /** Infinity literal (`inf`). */
  Infinity = 'infinity',
  /** NaN literal, with or without a hex payload (e.g. `nan`, `nan:0x200000`). */
  Nan = 'nan',
}

// ---------------------------------------------------------------------------
// Float bit-pattern constants
// ---------------------------------------------------------------------------

const F32_SIGN_BIT = 0x80000000;
const F32_EXP_MASK = 0x7f800000;
const F32_MANTISSA_MASK = 0x007fffff;
const F32_INF_BITS = 0x7f800000;
const F32_CANONICAL_NAN_BITS = 0x7fc00000; // quiet NaN, zero payload
/** Mantissa of the canonical quiet NaN — the value bare `nan` denotes. */
const F32_CANONICAL_PAYLOAD = 0x400000;
const F32_EXP_BIAS = 127;

const F64_SIGN_BIT = 0x8000000000000000n;
const F64_EXP_MASK = 0x7ff0000000000000n;
const F64_MANTISSA_MASK = 0x000fffffffffffffn;
const F64_INF_BITS = 0x7ff0000000000000n;
const F64_CANONICAL_NAN_BITS = 0x7ff8000000000000n; // quiet NaN, zero payload
/** Mantissa of the canonical quiet NaN — the value bare `nan` denotes. */
const F64_CANONICAL_PAYLOAD = 0x8000000000000n;
const F64_EXP_BIAS = 1023;

// ---------------------------------------------------------------------------
// DataView helpers
// ---------------------------------------------------------------------------

function floatToF32Bits(v: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v);
  return new DataView(buf).getUint32(0);
}

function floatToF64Bits(v: number): bigint {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, v);
  return new DataView(buf).getBigUint64(0);
}

// ---------------------------------------------------------------------------
// Hex float parser (shared between f32 and f64)
// ---------------------------------------------------------------------------

// Matches: [+-]?0[xX][hex]*[.[hex]*]?[pP][+-]?[dec]+
const HEX_FLOAT_RE = /^([+-]?)0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?[0-9]+)$/;

function parseHexFloat(s: string): number | null {
  const m = HEX_FLOAT_RE.exec(s);
  if (!m) return null;
  const [, sign, intPart, fracPart, expStr] = m;
  const intVal = intPart && intPart.length > 0 ? parseInt(intPart, 16) : 0;
  const fracVal = fracPart && fracPart.length > 0
    ? parseInt(fracPart, 16) / Math.pow(16, fracPart.length)
    : 0;
  const result = (intVal + fracVal) * Math.pow(2, parseInt(expStr!));
  return sign === '-' ? -result : result;
}

// ---------------------------------------------------------------------------
// Integer literal parsing
// ---------------------------------------------------------------------------

/**
 * Parses a decimal or hex (`0x`-prefixed) unsigned 32-bit integer literal.
 *
 * @param s - The literal string, e.g. `"42"`, `"0x2a"`.
 * @returns `[Result.Ok, value]` on success or `[Result.Error, 0]` on failure.
 */
export function parseU32Literal(s: string): [result: Result, value: number] {
  const t = s.trim();
  if (t.length === 0) return [Result.Error, 0];
  let value: number;
  if (t.startsWith('0x') || t.startsWith('0X')) {
    const hex = t.slice(2);
    if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) return [Result.Error, 0];
    value = parseInt(hex, 16);
  } else {
    if (!/^[0-9]+$/.test(t)) return [Result.Error, 0];
    value = parseInt(t, 10);
  }
  if (!isFinite(value) || value < 0 || value > 0xffffffff) return [Result.Error, 0];
  return [Result.Ok, value >>> 0];
}

/**
 * Parses a decimal or hex signed 32-bit integer literal.
 * Accepts an optional leading `-` sign. Returns the two's-complement bit
 * pattern — negative values are returned as their unsigned equivalent
 * (e.g. `-1` → `0xffffffff`).
 *
 * @param s - The literal string.
 * @returns `[Result.Ok, bits]` on success or `[Result.Error, 0]` on failure.
 */
export function parseS32Literal(s: string): [result: Result, value: number] {
  const t = s.trim();
  const negative = t.startsWith('-');
  const abs = negative ? t.slice(1) : t;
  const [r, uval] = parseU32Literal(abs);
  if (r === Result.Error) return [Result.Error, 0];
  if (negative) {
    // WAT allows -2147483648 through -1; anything whose absolute value > 2^32 is invalid
    if (uval === 0) return [Result.Error, 0]; // -0 in the unsigned-only context is invalid
    return [Result.Ok, (-uval) | 0];
  }
  return [Result.Ok, uval | 0];
}

/**
 * Parses a decimal or hex unsigned 64-bit integer literal.
 *
 * @param s - The literal string.
 * @returns `[Result.Ok, value]` on success or `[Result.Error, 0n]` on failure.
 */
export function parseU64Literal(s: string): [result: Result, value: bigint] {
  const t = s.trim();
  if (t.length === 0) return [Result.Error, 0n];
  let value: bigint;
  try {
    if (t.startsWith('0x') || t.startsWith('0X')) {
      const hex = t.slice(2);
      if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) return [Result.Error, 0n];
      value = BigInt('0x' + hex);
    } else {
      if (!/^[0-9]+$/.test(t)) return [Result.Error, 0n];
      value = BigInt(t);
    }
  } catch {
    return [Result.Error, 0n];
  }
  if (value < 0n || value > 0xffffffffffffffffn) return [Result.Error, 0n];
  return [Result.Ok, value];
}

/**
 * Parses a decimal or hex signed 64-bit integer literal.
 * Returns the two's-complement bit pattern as an unsigned BigInt.
 *
 * @param s - The literal string.
 * @returns `[Result.Ok, bits]` on success or `[Result.Error, 0n]` on failure.
 */
export function parseS64Literal(s: string): [result: Result, value: bigint] {
  const t = s.trim();
  const negative = t.startsWith('-');
  const abs = negative ? t.slice(1) : t;
  const [r, uval] = parseU64Literal(abs);
  if (r === Result.Error) return [Result.Error, 0n];
  if (negative) {
    if (uval === 0n) return [Result.Error, 0n];
    return [Result.Ok, BigInt.asIntN(64, -uval)];
  }
  return [Result.Ok, BigInt.asIntN(64, uval)];
}

// ---------------------------------------------------------------------------
// Float literal parsing
// ---------------------------------------------------------------------------

/**
 * Parses a WAT float literal into the bit pattern of an IEEE 754 32-bit float.
 *
 * Handles decimal floats, hex floats (`0x1.8p+1`), `inf`, `-inf`, `nan`,
 * `-nan`, `nan:0x<payload>`, and `-nan:0x<payload>`.
 *
 * @param s - The literal string.
 * @returns `[Result.Ok, bits]` on success or `[Result.Error, 0]` on failure.
 *   The `bits` value is the raw 32-bit IEEE 754 bit pattern as an unsigned integer.
 */
export function parseF32Literal(s: string): [result: Result, bits: number] {
  const t = s.trim();
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1) : t;
  const signBits = negative ? F32_SIGN_BIT : 0;

  if (body === 'inf') {
    return [Result.Ok, (signBits | F32_INF_BITS) >>> 0];
  }

  if (body === 'nan') {
    return [Result.Ok, (signBits | F32_CANONICAL_NAN_BITS) >>> 0];
  }

  if (body.startsWith('nan:0x') || body.startsWith('nan:0X')) {
    const payloadStr = body.slice(6);
    if (!/^[0-9a-fA-F]+$/.test(payloadStr)) return [Result.Error, 0];
    const payload = parseInt(payloadStr, 16);
    if (payload === 0 || payload > F32_MANTISSA_MASK) return [Result.Error, 0];
    // The mantissa IS the payload — no quiet bit is forced. Forcing it made
    // `nan:0x200000` (a signalling NaN) decode as 0x7fe00000, and disagreed
    // with `parseF32LiteralBits` in the WAT parser, which is the one
    // `wat2wasm` calls and which was already right (T10.4).
    const bits = F32_INF_BITS | (payload & F32_MANTISSA_MASK);
    return [Result.Ok, (signBits | bits) >>> 0];
  }

  // Hex float
  const hexVal = parseHexFloat(negative ? '-' + body : body);
  if (hexVal !== null) {
    return [Result.Ok, floatToF32Bits(Math.fround(hexVal))];
  }

  // Decimal float
  if (/^[0-9]/.test(body) || body.startsWith('.')) {
    const v = parseFloat(negative ? '-' + body : body);
    if (!isNaN(v)) {
      return [Result.Ok, floatToF32Bits(Math.fround(v))];
    }
  }

  return [Result.Error, 0];
}

/**
 * Parses a WAT float literal into the bit pattern of an IEEE 754 64-bit float.
 *
 * Handles decimal floats, hex floats, `inf`, `-inf`, `nan`, `-nan`,
 * `nan:0x<payload>`, and `-nan:0x<payload>`.
 *
 * @param s - The literal string.
 * @returns `[Result.Ok, bits]` on success or `[Result.Error, 0n]` on failure.
 *   The `bits` value is the raw 64-bit IEEE 754 bit pattern as a BigInt.
 */
export function parseF64Literal(s: string): [result: Result, bits: bigint] {
  const t = s.trim();
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1) : t;
  const signBits = negative ? F64_SIGN_BIT : 0n;

  if (body === 'inf') {
    return [Result.Ok, signBits | F64_INF_BITS];
  }

  if (body === 'nan') {
    return [Result.Ok, signBits | F64_CANONICAL_NAN_BITS];
  }

  if (body.startsWith('nan:0x') || body.startsWith('nan:0X')) {
    const payloadStr = body.slice(6);
    if (!/^[0-9a-fA-F]+$/.test(payloadStr)) return [Result.Error, 0n];
    let payload: bigint;
    try {
      payload = BigInt('0x' + payloadStr);
    } catch {
      return [Result.Error, 0n];
    }
    if (payload === 0n || payload > F64_MANTISSA_MASK) return [Result.Error, 0n];
    // As in parseF32Literal: the mantissa is the payload, unmodified.
    const bits = F64_INF_BITS | (payload & F64_MANTISSA_MASK);
    return [Result.Ok, signBits | bits];
  }

  // Hex float
  const hexVal = parseHexFloat(negative ? '-' + body : body);
  if (hexVal !== null) {
    return [Result.Ok, floatToF64Bits(hexVal)];
  }

  // Decimal float
  if (/^[0-9]/.test(body) || body.startsWith('.')) {
    const v = parseFloat(negative ? '-' + body : body);
    if (!isNaN(v)) {
      return [Result.Ok, floatToF64Bits(v)];
    }
  }

  return [Result.Error, 0n];
}

// ---------------------------------------------------------------------------
// Float literal printing
// ---------------------------------------------------------------------------

/**
 * Converts an IEEE 754 32-bit float bit pattern to its canonical WAT literal
 * string. Special values use named forms; normal values use hex float notation
 * (`0xL.XXXXXXp+EXP`) to guarantee an exact round-trip.
 *
 * @param bits - The raw 32-bit IEEE 754 bit pattern (unsigned).
 * @returns The WAT literal string.
 */
export function printF32Literal(bits: number): string {
  const b = bits >>> 0;
  const negative = (b & F32_SIGN_BIT) !== 0;
  const rawExp = (b & F32_EXP_MASK) >>> 23;
  const mantissa = b & F32_MANTISSA_MASK;
  const sign = negative ? '-' : '';

  if (rawExp === 0xff) {
    if (mantissa === 0) return sign + 'inf';
    // NaN. `nan:0x<n>` names the mantissa EXACTLY — the spec does not treat
    // the quiet bit specially there, and the testsuite writes both
    // `nan:0x400000` (the canonical quiet NaN) and `nan:0x7fffff`. Bare `nan`
    // is the canonical quiet NaN and nothing else.
    //
    // This used to strip the quiet bit before printing, on the theory that
    // "the parser always ORs it back in". Two parsers disagreed: the one that
    // matters — `parseF32LiteralBits` in the WAT parser, which `wat2wasm`
    // actually calls — reads the payload exactly, per the spec. So printing
    // 0x7fffffff as `nan:0x3fffff` re-parsed to 0x7fbfffff, turning a QUIET
    // NaN into a SIGNALLING one: valid wasm, different value (T10.4).
    return sign +
      (mantissa === F32_CANONICAL_PAYLOAD ? 'nan' : 'nan:0x' + mantissa.toString(16));
  }

  if (rawExp === 0 && mantissa === 0) return sign + '0x0p+0';

  // Normal and subnormal numbers
  const isNormal = rawExp !== 0;
  const trueExp = isNormal ? rawExp - F32_EXP_BIAS : 1 - F32_EXP_BIAS;
  const leading = isNormal ? '1' : '0';
  // Shift mantissa left by 1 to align 23 bits to 24 bits (6 hex digits)
  const fracHex = (mantissa << 1).toString(16).padStart(6, '0').replace(/0+$/, '') || '0';
  return `${sign}0x${leading}.${fracHex}p${trueExp >= 0 ? '+' : ''}${trueExp}`;
}

/**
 * Converts an IEEE 754 64-bit float bit pattern to its canonical WAT literal
 * string. Special values use named forms; normal values use hex float notation
 * to guarantee an exact round-trip.
 *
 * @param bits - The raw 64-bit IEEE 754 bit pattern as a BigInt.
 * @returns The WAT literal string.
 */
export function printF64Literal(bits: bigint): string {
  const b = BigInt.asUintN(64, bits);
  const negative = (b & F64_SIGN_BIT) !== 0n;
  const rawExp = Number((b & F64_EXP_MASK) >> 52n);
  const mantissa = b & F64_MANTISSA_MASK;
  const sign = negative ? '-' : '';

  if (rawExp === 0x7ff) {
    if (mantissa === 0n) return sign + 'inf';
    // As in printF32Literal: `nan:0x<n>` names the mantissa exactly, and bare
    // `nan` is the canonical quiet NaN.
    return sign +
      (mantissa === F64_CANONICAL_PAYLOAD ? 'nan' : 'nan:0x' + mantissa.toString(16));
  }

  if (rawExp === 0 && mantissa === 0n) return sign + '0x0p+0';

  const isNormal = rawExp !== 0;
  const trueExp = isNormal ? rawExp - F64_EXP_BIAS : 1 - F64_EXP_BIAS;
  const leading = isNormal ? '1' : '0';
  // f64 mantissa is 52 bits = 13 hex digits, already aligned to 4-bit boundary
  const fracHex = mantissa.toString(16).padStart(13, '0').replace(/0+$/, '') || '0';
  return `${sign}0x${leading}.${fracHex}p${trueExp >= 0 ? '+' : ''}${trueExp}`;
}

// ---------------------------------------------------------------------------
// String literals
// ---------------------------------------------------------------------------

/**
 * Strict UTF-8 decoder for wasm NAME positions.
 *
 * A wasm name (import module/field, export, custom-section id, quoted
 * identifier, annotation id) must be valid UTF-8, so an invalid sequence makes
 * the module malformed rather than being something to repair. The lenient
 * default substitutes U+FFFD, which silently produces a DIFFERENT,
 * valid-looking name (T12.5).
 *
 * `ignoreBOM: true` is load-bearing: a leading U+FEFF in a name is a
 * CHARACTER, not an encoding marker (T7.13). Without it `TextDecoder` strips
 * it and the export is silently renamed — that dropped V8-valid 257 -> 256 the
 * moment this decoder was introduced without the flag.
 */
export const STRICT_NAME_DECODER: TextDecoder = new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true,
});

/** Shared UTF-8 encoder; WAT source is UTF-8, so raw characters encode as such. */
const TEXT_ENCODER = new TextEncoder();

/**
 * Decode a WAT string literal (quotes included or not) to its BYTES.
 *
 * WAT strings are BYTE strings: an escaped 0xff is one byte, not a character.
 * Callers that need a NAME must run the result through
 * {@link STRICT_NAME_DECODER}; callers that need raw bytes (data segments)
 * must NOT -- a data segment holding arbitrary bytes is legal.
 */
export function decodeStringToken(text: string): Uint8Array {
  // strip surrounding quotes
  if (text.startsWith('"')) text = text.slice(1);
  if (text.endsWith('"')) text = text.slice(0, -1);
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === 0x5c) { // backslash
      i++;
      const e = text.charCodeAt(i);
      switch (e) {
        case 0x74:
          bytes.push(0x09);
          i++;
          break; // \t
        case 0x6e:
          bytes.push(0x0a);
          i++;
          break; // \n
        case 0x72:
          bytes.push(0x0d);
          i++;
          break; // \r
        case 0x22:
          bytes.push(0x22);
          i++;
          break; // \"
        case 0x27:
          bytes.push(0x27);
          i++;
          break; // \'
        case 0x5c:
          bytes.push(0x5c);
          i++;
          break; // \\
        case 0x75: { // \u{XXXX}
          i += 2; // skip 'u{'
          let scalar = 0;
          while (i < text.length && text[i] !== '}') {
            scalar = (scalar << 4) | parseInt(text[i]!, 16);
            i++;
          }
          i++; // skip '}'
          // encode scalar as UTF-8
          if (scalar < 0x80) bytes.push(scalar);
          else if (scalar < 0x800) {
            bytes.push(0xc0 | (scalar >> 6));
            bytes.push(0x80 | (scalar & 0x3f));
          } else if (scalar < 0x10000) {
            bytes.push(0xe0 | (scalar >> 12));
            bytes.push(0x80 | ((scalar >> 6) & 0x3f));
            bytes.push(0x80 | (scalar & 0x3f));
          } else {
            bytes.push(0xf0 | (scalar >> 18));
            bytes.push(0x80 | ((scalar >> 12) & 0x3f));
            bytes.push(0x80 | ((scalar >> 6) & 0x3f));
            bytes.push(0x80 | (scalar & 0x3f));
          }
          break;
        }
        default: { // hex escape
          const hi = parseInt(text[i]!, 16);
          i++;
          const lo = parseInt(text[i]!, 16);
          i++;
          bytes.push((hi << 4) | lo);
        }
      }
    } else if (ch < 0x80) {
      bytes.push(ch);
      i++;
    } else {
      // A raw non-ASCII character. WAT strings are BYTE strings, and the
      // source is UTF-8, so the character contributes its UTF-8 encoding.
      // `bytes.push(ch)` pushed the UTF-16 code unit as a single byte, which
      // silently truncated every non-ASCII character: `é` (U+00E9) emitted
      // `e9` instead of `c3 a9`, and U+F61A emitted `1a` instead of
      // `ef 98 9a`. That corrupted data segments and import/export names.
      // Consume a whole code point so surrogate pairs survive.
      const cp = text.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      for (const b of TEXT_ENCODER.encode(String.fromCodePoint(cp))) bytes.push(b);
      i += width;
    }
  }
  return new Uint8Array(bytes);
}
