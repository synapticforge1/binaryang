// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * S7 — the text-form marker: which functions were WRITTEN LINEARLY, so that
 * `wasm2wat` gives back the form `wat2wasm` was given.
 *
 * Owner, 2026-09-19: "The first rule is fidelity for the wat2wasm and
 * wasm2wat… this part transpiles verbatim. The optimization does not and is not
 * fidelity tied, and must use the folded structure in the tree." So the fact
 * is as-written metadata: it lives in the module's fidelity side table
 * (`FidelityEntry.linearBody`, on each function's `nodeId`), which every pass
 * run resets — the optimizer strips it with no code of its own.
 *
 * ## The section — `binaryang.text-form`, version 1
 *
 * A custom section, written LAST (after the `name` section), so any engine or
 * tool ignores it and a read → write round trip puts it back where it was:
 *
 *     u8   version                (1)
 *     u32  count                  (LEB128)
 *     u32  function index × count (LEB128, ascending; the function index
 *                                  space, imports first — DEFINED functions only)
 *
 * The listed functions were written linearly; every other function folded.
 * ABSENCE means all folded, so a binary made before this existed, or by any
 * other tool, reads exactly as it always did. Granularity is per FUNCTION
 * (owner's choice): measured, mixing happens between functions, rarely within
 * one (2 of ~7,600 functions in the wasmtk corpus) — a function that mixes the
 * forms is recorded as folded. A later version can go finer; a reader that
 * meets a version it does not know keeps the section as raw bytes and prints
 * folded.
 */

import type { Func, Module } from './ir.ts';
import { countImports } from './ir.ts';
import { ExternalKind } from '../core/binary.ts';

/** The custom section's name. */
export const TEXT_FORM_SECTION = 'binaryang.text-form';

/** The format this module writes and reads. */
export const TEXT_FORM_VERSION = 1;

/** Whether function `f`'s body was written linearly (its source form). */
export function isWrittenLinear(m: Module, f: Func): boolean {
  return m.fidelity.get(f.nodeId)?.linearBody === true;
}

/** Record that `f`'s body was written linearly. */
export function markWrittenLinear(m: Module, f: Func): void {
  if (f.nodeId === undefined) {
    (f as { nodeId?: Func['nodeId'] }).nodeId = m.fidelity.record({ linearBody: true });
  } else {
    m.fidelity.set(f.nodeId, { linearBody: true });
  }
}

/** The function-space indices of the defined functions written linearly, ascending. */
export function linearFunctionIndices(m: Module): number[] {
  const base = countImports(m, ExternalKind.Func);
  const out: number[] = [];
  m.functions.forEach((f, i) => {
    if (isWrittenLinear(m, f)) out.push(base + i);
  });
  return out;
}

/** The section's payload for `indices`, or `null` when there is nothing to record. */
export function encodeTextForm(indices: readonly number[]): Uint8Array | null {
  if (indices.length === 0) return null;
  const out: number[] = [TEXT_FORM_VERSION];
  writeU32(out, indices.length);
  for (const i of indices) writeU32(out, i);
  return new Uint8Array(out);
}

/**
 * The indices a payload lists, or `null` when it is not a version-1 payload
 * this reader can apply — unknown version, truncated, trailing bytes, or not
 * ascending. `null` means: keep the section as raw bytes, print folded.
 */
export function decodeTextForm(data: Uint8Array): number[] | null {
  if (data.length === 0 || data[0] !== TEXT_FORM_VERSION) return null;
  const at = { pos: 1 };
  const count = readU32(data, at);
  if (count === null) return null;
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const i = readU32(data, at);
    if (i === null || (out.length > 0 && i <= out[out.length - 1]!)) return null;
    out.push(i);
  }
  return at.pos === data.length ? out : null;
}

/**
 * Mark the functions `indices` names. False — and nothing marked — when one
 * is not a DEFINED function of `m`, so a section that does not fit the module
 * it sits in is kept raw rather than half-applied.
 */
export function applyTextForm(m: Module, indices: readonly number[]): boolean {
  const base = countImports(m, ExternalKind.Func);
  const funcs = indices.map((i) => m.functions[i - base]);
  if (indices.some((i) => i < base) || funcs.some((f) => f === undefined)) return false;
  for (const f of funcs) markWrittenLinear(m, f!);
  return true;
}

function writeU32(out: number[], n: number): void {
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
}

function readU32(data: Uint8Array, at: { pos: number }): number | null {
  let result = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (at.pos >= data.length) return null;
    const byte = data[at.pos++]!;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return result <= 0xffffffff ? result : null;
  }
  return null;
}
