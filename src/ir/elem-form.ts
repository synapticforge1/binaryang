// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Which encoding an element segment takes — shared by the binary writer and the validator, and
 * internal (not re-exported by `./ir`).
 */

import { type ElemSegment, isRefValueType } from './ir.ts';

/**
 * Whether `seg` is the FUNCIDX form (element flags 0-3): every entry a lone `ref.func` and the
 * type the form implies, the non-null `(ref func)`. The binary writer encodes a segment so exactly
 * when this holds, and the validator reads it as the form Wasm 1.0 had: a list of function
 * indices with an implied type, not instructions with a typed reference (open-work 41).
 */
export function isFuncIdxElemSegment(seg: ElemSegment): boolean {
  const t = seg.elemType;
  return isRefValueType(t) && !t.nullable && t.heapType.kind === 'abstract' &&
    t.heapType.name === 'func' &&
    seg.elemExprs.every((xs) => xs.children.length === 1 && xs.children[0]!.kind === 'ref.func');
}
