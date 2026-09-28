// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/encoder/write-wasm
 *
 * A binaryen-ts module — as read, as optimized, or as the API built it — to
 * bytes, through the ONE binary writer (wabt-ts's). One front end, stage 4.
 *
 * wabt-ts's writer takes a tree whose references are indices and whose every
 * type use names a type-section entry — what `wat2wasm` hands it after
 * `resolveNames` and `synthesizeTypes`. A tree the optimizer or the API made
 * references by NAME, and carries blocks and calls no type names yet. So the
 * same two steps run first — the "resolve step" of the plan (refinement 2) —
 * and they do nothing to what was written: an index as written stays
 * (`synthesizeTypes` keeps a written type while it still matches), and a type
 * is appended only where none exists, after every existing one.
 *
 * ⚠️ Those steps CHANGE the tree they run on (names to indices; types
 * appended), and binaryen-ts's passes need names. The caller's module may be
 * written and then optimized again (`Module.emitBinary`, `toBinary`), so they
 * run on a COPY.
 *
 * Parity, measured when it replaced binaryen-ts's encoder at the entry points:
 * over 2,919 inputs (the 421-module corpus and every spec module V8 accepts),
 * unoptimized and at -O1 / -O2 / -O3 / -Oz, all 14,595 outputs byte-identical
 * to `encodeWasm`'s — after the four defects the comparison found were fixed on
 * both sides (cmem/ir-convergence.md, One front end, stage 4).
 */

import { resolveNames } from '../../wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../wabt-ts/ir/synthesize-types.ts';
import { writeBinaryIr } from '../../wabt-ts/writer/binary-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../wabt-ts/core/error.ts';
import { FidelityTable } from '../../wabt-ts/ir/fidelity.ts';
import type { WasmModule } from '../ir/module.ts';
import { WasmEncodeError } from './wasm-encoder.ts';

/**
 * `m` as `.wasm` bytes. The module is not changed.
 *
 * Names are written when the module has them to write (`hasNameSection`) —
 * the encoder's rule: a pass run without `debugInfo` clears it.
 *
 * @throws {WasmEncodeError} when a reference names nothing the module has.
 */
export function writeWasm(m: WasmModule): Uint8Array {
  const copy = copyModule(m);
  const errors = makeErrorList();
  resolveNames(copy, errors);
  if (hasErrors(errors)) {
    throw new WasmEncodeError(`cannot write the module: ${formatErrors(errors).trim()}`);
  }
  synthesizeTypes(copy);
  return writeBinaryIr(copy, { writeDebugNames: copy.hasNameSection });
}

/**
 * A structural copy of `m`: every array, object, `Map` and `Set` new, the
 * fidelity table cloned, byte payloads shared (nothing here writes into them).
 */
function copyModule(m: WasmModule): WasmModule {
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Uint8Array) return v;
    if (v instanceof FidelityTable) return v.clone();
    if (Array.isArray(v)) return v.map(copy);
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, copy(x)]));
    if (v instanceof Set) return new Set([...v].map(copy));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = copy(x);
    return out;
  };
  return copy(m) as WasmModule;
}
