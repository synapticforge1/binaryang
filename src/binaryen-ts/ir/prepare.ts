// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/ir/prepare
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

import type { Module } from '../../wabt-ts/ir/ir.ts';
import { nameReferences } from '../../wabt-ts/ir/name-references.ts';
import { deriveTypes } from './derive-types.ts';
import type { WasmModule } from './module.ts';

/** Make `m` ready for binaryen-ts's passes and encoder, in place. See the module doc. */
export function prepareForPasses(m: Module): WasmModule {
  nameReferences(m);
  deriveTypes(m);
  return m;
}
