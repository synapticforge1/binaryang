// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The spec's OWN expected values, as the oracle for what binaryang writes (C-R2-5, security review
 * round 4). The differential in `differential.ts` compares each variant with V8's run of the
 * original; this compares each run with what the testsuite's `assert_return` / `assert_trap` /
 * `assert_exhaustion` / `assert_exception` commands SAY, as wabt's `spectest-interp` does — so a
 * module that V8 and binaryang both get wrong the same way is caught.
 *
 * The rules, as the spec's script interpreter has them:
 *
 * - integers and floats are compared by BITS (the manifest spells every number as its unsigned
 *   decimal bit pattern); `nan:canonical` and `nan:arithmetic` are the two NaN classes — canonical:
 *   the quiet bit set and every other payload bit clear (either sign); arithmetic: the quiet bit
 *   set (any payload, either sign);
 * - a `v128` is its lanes by `lane_type`, each lane by the rules above;
 * - a reference by kind: `ref.null` is `null`, `ref.func` a function, `ref.extern n` the host
 *   value the invocation built, `ref.i31` / `ref.struct` / `ref.array` / `ref.eq` any non-null value;
 * - a trap is a `WebAssembly.RuntimeError` (the JS API's trap class; the spec's message TEXT is not
 *   compared — V8 words its traps its own way), exhaustion a `RangeError`, an exception a
 *   `WebAssembly.Exception`; a plain `action` must complete.
 *
 * The one limit of the JS API: a scalar `f32` / `f64` crosses it as a JS number, and an engine may
 * quiet a signalling NaN there. A literal-bits expectation that is a NaN is therefore met by any
 * NaN of the expected SIGN when the payload cannot be observed (counted as `nanBoundary`), never by
 * a non-NaN and never by a NaN of the other sign. The sign does cross the boundary on V8 (the
 * engine this check runs on: `scripts/v8.ts`); an engine that canonicalises NaNs (JavaScriptCore
 * returns a positive one) cannot show a negative expectation met, which this then reports. `v128` lanes never cross as floats (the wrapper passes `i64`), so they are
 * exact.
 */

/** What the manifest says an invocation does. */
export type Expect =
  | { kind: 'return'; values: ExpectedValue[]; either?: ExpectedValue[] }
  | { kind: 'trap' }
  | { kind: 'exhaustion' }
  | { kind: 'exception' }
  | { kind: 'complete' };

/** One value as the manifest spells it. */
export interface ExpectedValue {
  type: string;
  value?: unknown;
  lane_type?: string;
}

/** What running an invocation did: its results (normalised to an array), or how it threw. */
export type Raw =
  | { ok: true; values: unknown[]; wrapped: boolean; bits?: boolean }
  | { ok: false; kind: 'trap' | 'exhaustion' | 'exception' | 'other'; detail: string };

/** How an expectation was met, for the counts. */
export interface Verdict {
  /** `undefined` when the expectation holds, else why not. */
  problem?: string;
  /** A NaN met without its payload being observable (the JS API boundary). */
  nanBoundary?: boolean;
}

const dv = new DataView(new ArrayBuffer(8));

export function f32Bits(x: number): number {
  dv.setFloat32(0, x);
  return dv.getUint32(0);
}
export function f64Bits(x: number): bigint {
  dv.setFloat64(0, x);
  return dv.getBigUint64(0);
}

/** `want` is `nan:canonical`, `nan:arithmetic` or a decimal bit pattern; `bits` the actual bits. */
function floatBitsMatch(width: 32 | 64, want: string, bits: bigint): boolean {
  const quiet = width === 32 ? 0x400000n : 0x8000000000000n;
  const exp = width === 32 ? 0x7f800000n : 0x7ff0000000000000n;
  const mag = width === 32 ? 0x7fffffffn : 0x7fffffffffffffffn;
  if (want === 'nan:canonical') return (bits & mag) === (exp | quiet);
  if (want === 'nan:arithmetic') return (bits & (exp | quiet)) === (exp | quiet);
  return bits === BigInt.asUintN(width, BigInt(want));
}

/** The sign bit of a literal float's bit pattern (`want` is a decimal bit pattern, not a class). */
const signOf = (width: 32 | 64, want: string): bigint =>
  BigInt.asUintN(width, BigInt(want)) >> BigInt(width - 1);

const isNaNBits = (width: 32 | 64, want: string): boolean => {
  if (want.startsWith('nan:')) return false; // handled by its own class
  const b = BigInt.asUintN(width, BigInt(want));
  const exp = width === 32 ? 0x7f800000n : 0x7ff0000000000000n;
  const mant = width === 32 ? 0x7fffffn : 0xfffffffffffffn;
  return (b & exp) === exp && (b & mant) !== 0n;
};

/** One expected value against one actual (a `v128` is two consecutive `i64` — see `matchValues`). */
function matchScalar(
  e: ExpectedValue,
  a: unknown,
  v: Verdict,
  bits: boolean,
): string | undefined {
  const want = e.value as string | undefined;
  switch (e.type) {
    case 'i32':
      return typeof a === 'number' && a === Number(BigInt.asIntN(32, BigInt(want!)))
        ? undefined
        : `want i32 ${want}, got ${String(a)}`;
    case 'i64':
      return typeof a === 'bigint' && a === BigInt.asIntN(64, BigInt(want!))
        ? undefined
        : `want i64 ${want}, got ${String(a)}`;
    case 'f32': {
      if (bits) {
        // Through a wrapper: the result IS its bits, an i32.
        if (typeof a !== 'number') return `want f32 ${want}, got ${String(a)}`;
        return floatBitsMatch(32, want!, BigInt(a >>> 0))
          ? undefined
          : `want f32 ${want}, got bits ${a >>> 0}`;
      }
      if (typeof a !== 'number') return `want f32 ${want}, got ${String(a)}`;
      if (floatBitsMatch(32, want!, BigInt(f32Bits(a)))) return undefined;
      if (
        isNaNBits(32, want!) && Number.isNaN(a) && signOf(32, want!) === BigInt(f32Bits(a) >>> 31)
      ) {
        v.nanBoundary = true;
        return undefined;
      }
      return `want f32 ${want}, got bits ${f32Bits(a)}`;
    }
    case 'f64': {
      if (bits) {
        if (typeof a !== 'bigint') return `want f64 ${want}, got ${String(a)}`;
        return floatBitsMatch(64, want!, BigInt.asUintN(64, a))
          ? undefined
          : `want f64 ${want}, got bits ${BigInt.asUintN(64, a)}`;
      }
      if (typeof a !== 'number') return `want f64 ${want}, got ${String(a)}`;
      if (floatBitsMatch(64, want!, f64Bits(a))) return undefined;
      if (isNaNBits(64, want!) && Number.isNaN(a) && signOf(64, want!) === f64Bits(a) >> 63n) {
        v.nanBoundary = true;
        return undefined;
      }
      return `want f64 ${want}, got bits ${f64Bits(a)}`;
    }
    case 'externref':
    case 'anyref': {
      // `ref.extern n`: the host value the invocation's own argument made — `{ extern: 'n' }`;
      // `null` for `ref.null`.
      if (want === 'null') return a === null ? undefined : `want null ${e.type}, got ${show(a)}`;
      if (want === undefined) return a !== null ? undefined : `want a non-null ${e.type}, got null`;
      return typeof a === 'object' && a !== null && (a as { extern?: unknown }).extern === want
        ? undefined
        : `want ${e.type} ${want}, got ${show(a)}`;
    }
    case 'funcref':
      if (want === 'null') return a === null ? undefined : `want null funcref, got ${show(a)}`;
      return typeof a === 'function' ? undefined : `want a funcref, got ${show(a)}`;
    case 'exnref':
      if (want === 'null') return a === null ? undefined : `want null exnref, got ${show(a)}`;
      return a !== null && a !== undefined ? undefined : `want an exnref, got ${show(a)}`;
    case 'refnull':
    case 'nullref':
    case 'nullfuncref':
    case 'nullexnref':
    case 'nullexternref':
      return a === null ? undefined : `want null (${e.type}), got ${show(a)}`;
    case 'arrayref':
    case 'eqref':
    case 'i31ref':
    case 'structref':
      return a !== null && a !== undefined
        ? undefined
        : `want a non-null ${e.type}, got ${show(a)}`;
    default:
      return `unknown expected type ${e.type}`;
  }
}

function show(x: unknown): string {
  if (x === null || x === undefined) return String(x);
  if (typeof x === 'object' && 'extern' in x) return `extern ${(x as { extern: unknown }).extern}`;
  return typeof x;
}

/** A `v128` from its two `i64` lanes against the manifest's lanes. */
function matchV128(e: ExpectedValue, lo: unknown, hi: unknown): string | undefined {
  if (typeof lo !== 'bigint' || typeof hi !== 'bigint') return 'want a v128 (as two i64 lanes)';
  const lanes = e.value as string[] | undefined;
  const lt = e.lane_type;
  if (lanes === undefined || lt === undefined) return `v128 expectation without lanes`;
  const width = { i8: 1, i16: 2, i32: 4, f32: 4, i64: 8, f64: 8 }[lt];
  if (width === undefined) return `v128 lane type ${lt}`;
  const d = new DataView(new ArrayBuffer(16));
  d.setBigInt64(0, lo, true);
  d.setBigInt64(8, hi, true);
  for (const [i, want] of lanes.entries()) {
    let bits = 0n;
    for (let k = width - 1; k >= 0; k--) bits = (bits << 8n) | BigInt(d.getUint8(i * width + k));
    const ok = lt === 'f32'
      ? floatBitsMatch(32, want, bits)
      : lt === 'f64'
      ? floatBitsMatch(64, want, bits)
      : bits === BigInt.asUintN(width * 8, BigInt(want));
    if (!ok) return `v128 lane ${i} (${lt}): want ${want}, got bits ${bits}`;
  }
  return lanes.length * width === 16 ? undefined : `v128 expectation has ${lanes.length} lanes`;
}

/** Matches the results of a call against the expected values, in order. */
export function matchValues(
  want: ExpectedValue[],
  raw: Raw & { ok: true },
  v: Verdict,
): string | undefined {
  const got = raw.values;
  let at = 0;
  for (const e of want) {
    if (e.type === 'v128') {
      const p = matchV128(e, got[at], got[at + 1]);
      if (p !== undefined) return p;
      at += 2;
    } else {
      const p = matchScalar(e, got[at], v, raw.bits === true);
      if (p !== undefined) return p;
      at += 1;
    }
  }
  return at === got.length ? undefined : `${got.length - at} more result(s) than expected`;
}

/** Does what happened meet what the manifest says? */
export function meets(expect: Expect, raw: Raw): Verdict {
  const v: Verdict = {};
  switch (expect.kind) {
    case 'complete':
      if (!raw.ok) v.problem = `want completion, got ${raw.kind}: ${raw.detail}`;
      break;
    case 'return':
      if (!raw.ok) v.problem = `want a return, got ${raw.kind}: ${raw.detail}`;
      else if (expect.either !== undefined) {
        // `either` (relaxed SIMD): the result may be any ONE of the listed alternatives.
        const tried = expect.either.map((alt) => matchValues([alt], raw, {}));
        if (!tried.includes(undefined)) {
          v.problem = `none of ${tried.length} alternatives: ${tried[0]}`;
        }
      } else {
        const p = matchValues(expect.values, raw, v);
        if (p !== undefined) v.problem = p;
      }
      break;
    case 'trap':
    case 'exhaustion':
    case 'exception':
      if (raw.ok) v.problem = `want ${expect.kind}, got a return`;
      else if (raw.kind !== expect.kind) {
        v.problem = `want ${expect.kind}, got ${raw.kind}: ${raw.detail}`;
      }
      break;
  }
  return v;
}

/** The expectation a manifest command makes of its action, or `undefined` for one we do not run. */
export function expectOf(c: Record<string, unknown>): Expect | undefined {
  switch (c['type']) {
    case 'assert_return':
      return {
        kind: 'return',
        values: (c['expected'] as ExpectedValue[] | undefined) ?? [],
        ...(c['either'] !== undefined ? { either: c['either'] as ExpectedValue[] } : {}),
      };
    case 'assert_trap':
      return { kind: 'trap' };
    case 'assert_exhaustion':
      return { kind: 'exhaustion' };
    case 'assert_exception':
      return { kind: 'exception' };
    case 'action':
      return { kind: 'complete' };
    default:
      return undefined;
  }
}
