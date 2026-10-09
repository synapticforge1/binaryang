// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module ir/prepare
 *
 * S6 step 5 item 6 (M8e): a module wabt-ts READ, made ready for binaryen-ts's
 * passes — what the bridge did by rebuilding it, done in place on the one
 * module type. Two things binaryen-ts's passes need that a wabt-ts tree does
 * not carry:
 *
 * - references by NAME — {@link nameReferences} (M8c), which names every entity
 *   and label first where the reader did not;
 * - every node's `type` — {@link deriveTypes} (M8d).
 *
 * For text, run it after `resolveNames` and `synthesizeTypes`, as `wat2wasm`
 * does; a binary read by wabt-ts's reader needs nothing first. The module is
 * changed IN PLACE and returned. Never on the `wat2wasm` / `wasm2wat` routes: a
 * name-form reference prints as `$name` where the author wrote an index.
 */

import type { Module } from './ir.ts';
import { nameReferences } from './name-references.ts';
import { readBinaryIr } from '../reader/binary-reader.ts';
import {
  formatErrors,
  hasErrors,
  isStackExhausted,
  makeErrorList,
  NESTING_TOO_DEEP,
} from '../core/error.ts';
import { allFeatures } from '../core/feature.ts';
import { validateModule } from '../validator/validator.ts';
import { deriveTypes } from './derive-types.ts';
import type { WasmModule } from './module.ts';

/**
 * Thrown when the bytes are not a module the reader can read. It moved here
 * from binaryen-ts's decoder, deleted at 1.6.0 (One front end stage 3b), with
 * the contract it had: the message is the reader's diagnostics.
 */
export class WasmBinaryError extends Error {
  /**
   * @param message - Human-readable description of the failure.
   * @param offset - Byte offset within the input where it was detected, if
   *   known; appended to the message in hex.
   */
  public readonly offset?: number | undefined;

  constructor(message: string, offset?: number) {
    super(offset !== undefined ? `${message} (at offset 0x${offset.toString(16)})` : message);
    this.name = 'WasmBinaryError';
    this.offset = offset;
  }
}

/** Make `m` ready for binaryen-ts's passes and encoder, in place. See the module doc. */
export function prepareForPasses(m: Module): WasmModule {
  nameReferences(m);
  deriveTypes(m);
  return m;
}

/**
 * A binary, read for binaryen-ts: the ONE reader (wabt-ts's), then
 * {@link prepareForPasses} — every entry point that hands bytes to the
 * optimizer or the compat API goes through here (One front end, stage 3).
 *
 * It replaced binaryen-ts's own decoder (`parseWasm`) at those entry points.
 * Consequences, measured when it did: this reader REFUSES the invalid binaries
 * that decoder accepted (section order, counts, UTF-8, mutability bytes,
 * DataCount — inventory R2–R5), reads relaxed SIMD, which that decoder did not
 * (R17), and keeps a name section it cannot hold exactly as raw bytes (R8).
 *
 * @throws {WasmBinaryError} with the reader's diagnostics when the bytes are
 *   not a module it can read — the error `parseWasm` threw, so callers keep
 *   their contract.
 *
 * 🔧 The reader decodes STRUCTURE; it does not validate. An invalid module
 * whose structure reads — an out-of-range local, call or branch index, a
 * stack that does not balance — went on to {@link prepareForPasses}, which
 * threw a plain `Error` in its own words ("derive-types: no local …"): 13% of
 * a mutation fuzz of real producer output (open-work 13). Such a failure is
 * now answered by the VALIDATOR, on the failure path only, so a valid module
 * pays nothing: its diagnostics, at offsets into the caller's own bytes, are
 * the `WasmBinaryError`. Should the validator find nothing, the failure is
 * ours, and it is rethrown as it was — never disguised as the caller's.
 */
export function readForPasses(bytes: Uint8Array, filename = '<input>'): WasmModule {
  const errors = makeErrorList();
  let m: Module;
  try {
    m = readBinaryIr(bytes, errors, { filename, readDebugNames: true });
  } catch (e) {
    if (isStackExhausted(e)) throw new WasmBinaryError(`${filename}: ${NESTING_TOO_DEEP}`);
    throw e;
  }
  if (hasErrors(errors)) throw new WasmBinaryError(formatErrors(errors).trim());
  try {
    return prepareForPasses(m);
  } catch (e) {
    if (isStackExhausted(e)) throw new WasmBinaryError(`${filename}: ${NESTING_TOO_DEEP}`);
    const diagnostics = invalidity(bytes, filename);
    if (diagnostics !== null) throw new WasmBinaryError(diagnostics);
    throw e;
  }
}

/**
 * {@link readForPasses}, after VALIDATING the bytes — for a tool that runs or
 * transforms what it reads, so an invalid module is refused in the validator's
 * words, at offsets into the caller's file, before anything acts on it (as
 * upstream's `wasm-interp` and `wasm-ctor-eval` do, and `wasm-opt` here).
 *
 * @throws {WasmBinaryError} with the reader's or the validator's diagnostics.
 */
export function readValidForPasses(bytes: Uint8Array, filename = '<input>'): WasmModule {
  const diagnostics = invalidity(bytes, filename);
  if (diagnostics !== null) throw new WasmBinaryError(diagnostics);
  return readForPasses(bytes, filename);
}

/** The validator's diagnostics for `bytes`, or `null` when it finds the module valid. */
function invalidity(bytes: Uint8Array, filename: string): string | null {
  const errors = makeErrorList();
  try {
    const m = readBinaryIr(bytes, errors, { filename, readDebugNames: false });
    if (!hasErrors(errors)) validateModule(m, errors, { features: allFeatures() });
  } catch (e) {
    if (isStackExhausted(e)) return `${filename}: ${NESTING_TOO_DEEP}`;
    return null;
  }
  return hasErrors(errors) ? formatErrors(errors).trim() : null;
}
