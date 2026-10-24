// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module tools/memcpy-to-bulk-memory
 * A libc `memcpy` / `memmove` compiled into a module that lacks bulk memory becomes one
 * `memory.copy` (open-work 37; owner decision 5 of open-work 34, which lets a target permit what
 * the input does not use). `wasm-opt --memcpy-to-bulk-memory`, and under `--target portable` with
 * an optimization level. The one candidate real compiler output left (portability.md § "Decision 5
 * scoped"): TinyGo 0.43 ships wasi-libc's copy loops; 9–11% smaller at the same speed, measured.
 *
 * ## Recognised by EXACT code only (owner, 2026-10-24: "exact code match only")
 *
 * A function is rewritten only when its code-section body IN THE INPUT — local declarations and
 * every byte of its instructions — equals a body in {@link KNOWN_COPY_BODIES}, its type is
 * `(i32 i32 i32) -> i32`, and (for `memmove`, which calls `memcpy`) every `call` in it targets a
 * function recognised as `memcpy`: the call's immediate is the one byte range masked, located by
 * the reader, not by a byte search. Names play no part. Anything else is left alone.
 *
 * It runs on the input BYTES, before any pass: a pass sees a tree the runner has prepared
 * (written type indices dropped, stack values spilled), which no longer encodes to the input.
 *
 * ## The same result (owner: "if the rewrite … does not change the runtime result")
 *
 * For every defined call — the ranges in bounds, and for `memcpy` not overlapping — the bytes copied
 * and the value returned (`dst`) are the same. Owner, 2026-10-24, "1 is acceptable": two cases
 * differ by design — `memcpy` on OVERLAPPING ranges (undefined in C; musl's forward loop can
 * corrupt, `memory.copy` copies as `memmove`), and an OUT-OF-BOUNDS copy, which traps either way
 * but the loop has written the bytes before the bad address and `memory.copy` none.
 *
 * @license MIT
 */

import { asRegion, ExpressionKind, makeLocalGet, makeMemoryCopy } from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { type Var, varIndex } from '../ir/ir.ts';
import { ExternalKind } from '../core/binary.ts';
import { ValType } from '../ir/types.ts';
import { walkExpression } from '../ir/walk.ts';
import { KNOWN_COPY_BODIES, type KnownCopyBody } from './known-copy-bodies.ts';

const I32 = ValType.I32;
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
const KNOWN: { kind: KnownCopyBody['kind']; bytes: Uint8Array }[] = KNOWN_COPY_BODIES.map((k) => ({
  kind: k.kind,
  bytes: fromHex(k.hex),
}));

function uleb(b: Uint8Array, p: number): [value: number, length: number] {
  let v = 0, shift = 0, n = 0;
  for (;;) {
    const x = b[p + n++]!;
    v += (x & 0x7f) * 2 ** shift;
    shift += 7;
    if ((x & 0x80) === 0) return [v, n];
  }
}

/** Each code-section entry's body range, in order: [start, end) after its size. */
function codeBodies(b: Uint8Array): [number, number][] {
  let p = 8;
  while (p < b.length) {
    const [size, n] = uleb(b, p + 1);
    const start = p + 1 + n;
    if (b[p] === 10) {
      const [count, cn] = uleb(b, start);
      let q = start + cn;
      const out: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        const [sz, sn] = uleb(b, q);
        out.push([q + sn, q + sn + sz]);
        q += sn + sz;
      }
      return out;
    }
    p = start + size;
  }
  return [];
}

const isCopySig = (sig: { params: readonly unknown[]; results: readonly unknown[] }) =>
  sig.params.length === 3 && sig.params.every((t) => t === I32) && sig.results.length === 1 &&
  sig.results[0] === I32;

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The functions (indices into `module.functions`) whose code in `bytes` is a known libc copy, and
 * which. `module` must be the reader's tree of exactly these `bytes`, untouched by any pass.
 */
export function knownCopyFunctions(
  bytes: Uint8Array,
  module: WasmModule,
): Map<number, KnownCopyBody['kind']> {
  const found = new Map<number, KnownCopyBody['kind']>();
  if (!module.functions.some((f) => isCopySig(f.sig))) return found;
  const bodies = codeBodies(bytes);
  if (bodies.length !== module.functions.length) return found;
  const imported = module.imports.filter((i) => i.kind === ExternalKind.Func).length;
  const byName = new Map(module.functions.map((f, k) => [f.name, k]));
  // A call's target as an index into `functions`: by name, or by index past the imports.
  const targetOf = (v: Var): number =>
    v.kind === 'name' ? (byName.get(v.name) ?? -1) : v.value - imported;
  // Two rounds: `memmove` is recognised only once the `memcpy` it calls is.
  for (const round of ['memcpy', 'memmove'] as const) {
    module.functions.forEach((fn, k) => {
      if (found.has(k) || !isCopySig(fn.sig)) return;
      const [from, to] = bodies[k]!;
      const body = bytes.slice(from, to);
      let callsOk = true;
      walkExpression(fn.body, (e) => {
        if (e.kind !== ExpressionKind.Call) return;
        const at = e.loc?.offset;
        if (
          e.isReturn === true || at === undefined || at < from || at >= to || bytes[at] !== 0x10 ||
          found.get(targetOf(e.func)) !== 'memcpy'
        ) {
          callsOk = false;
          return;
        }
        const [, n] = uleb(bytes, at + 1);
        body.fill(0xff, at + 1 - from, at + 1 + n - from);
      });
      if (!callsOk) return;
      const known = KNOWN.find((x) => x.kind === round && equal(x.bytes, body));
      if (known !== undefined) found.set(k, known.kind);
    });
  }
  return found;
}

/**
 * Rewrites each known libc `memcpy` / `memmove` in `module` (the reader's tree of `bytes`) to
 * `memory.copy (dst, src, n)`, returning `dst`. Returns the names rewritten.
 */
export function memcpyToBulkMemory(bytes: Uint8Array, module: WasmModule): string[] {
  const done: string[] = [];
  for (const k of knownCopyFunctions(bytes, module).keys()) {
    const fn = module.functions[k]!;
    const get = (i: number) => makeLocalGet(varIndex(i), I32);
    fn.body = asRegion([makeMemoryCopy(get(0), get(1), get(2)), get(0)]);
    // Every slot, PARAMS FIRST: the three parameters, no locals left.
    fn.locals = [{ type: I32 }, { type: I32 }, { type: I32 }];
    done.push(fn.name);
  }
  return done;
}
