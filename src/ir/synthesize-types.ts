// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Ensure every function / function-import / tag / tag-import in the module
 * has a corresponding entry in `module.types` and a `typeVar` that points at
 * it.
 *
 * Why this pass exists: the WAT grammar allows inline `(param ...) (result
 * ...)` on a `(func ...)` or `(import ... (func ...))` without a separate
 * `(type ...)` declaration. The parser builds the IR with the inline
 * signature stored on the Func / Tag node, but it does not back-fill the
 * type section. The binary format requires every defined function /
 * function-import to reference a type-section entry, so the binary writer
 * emits a type index — and the resulting binary fails to decode if the
 * type section is missing or short.
 *
 * Reported by wasmtk's wabt-ts 1.0.4 migration: a minimal
 * `(module (func $add (param $a i32) (param $b i32) (result i32) ...))`
 * produced a binary with a function-section entry pointing at type 0 but
 * no type section. Fix: this pass.
 */

import { Type } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import { isRefValueType, varIndex } from './ir.ts';
import type { FuncSignature, Module, TypeEntry, ValueType } from './ir.ts';

const NO_LOC = { filename: '', line: 0, column: 0, offset: 0 };

/**
 * Walk `module.imports`, `module.funcs`, and `module.tags`; ensure that
 * `module.types` contains a `func`-kind entry matching each item's
 * signature, and update each item's `typeVar` to point at the matching
 * type index.
 */
export function synthesizeTypes(module: Module): void {
  const sigToIdx = new Map<string, number>();

  // Index existing type entries by their normalized signature so we don't
  // duplicate when a user-declared (type ...) already covers an inline sig.
  for (const [i, te] of module.types.entries()) {
    if (te.kind === 'func') sigToIdx.set(sigKey(te.sig), i);
  }

  const ensureTypeFor = (sig: FuncSignature): number => {
    const key = sigKey(sig);
    const existing = sigToIdx.get(key);
    if (existing !== undefined) return existing;
    const idx = module.types.length;
    const entry: TypeEntry = { kind: 'func', name: '', sig, loc: NO_LOC };
    module.types.push(entry);
    sigToIdx.set(key, idx);
    return idx;
  };

  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) {
      const idx = ensureTypeFor(imp.func.sig);
      imp.func.typeVar = varIndex(idx);
    } else if (imp.kind === ExternalKind.Tag) {
      const idx = ensureTypeFor(imp.tag.sig);
      // Tags reuse the func-type encoding for their signature.
      (imp.tag as { typeVar?: ReturnType<typeof varIndex> }).typeVar = varIndex(idx);
    }
  }

  for (const f of module.funcs) {
    const idx = ensureTypeFor(f.sig);
    f.typeVar = varIndex(idx);
  }

  for (const tag of module.tags) {
    const idx = ensureTypeFor(tag.sig);
    (tag as { typeVar?: ReturnType<typeof varIndex> }).typeVar = varIndex(idx);
  }
}

/**
 * Stable string key for a function signature. Two sigs hash to the same key
 * iff their params and results are equal element-wise. Uses the raw `Type`
 * numeric codes so the key is independent of any naming.
 */
function sigKey(sig: FuncSignature): string {
  return `(${sig.params.map(typeKey).join(',')})->(${sig.results.map(typeKey).join(',')})`;
}

function typeKey(t: ValueType): string {
  if (isRefValueType(t)) {
    // Distinguish concrete typed refs from each other AND from the abstract
    // type they used to collapse into, or two different `(ref $T)` signatures
    // would dedupe onto one type-section entry.
    const h = t.heapType.kind === 'index' ? `#${t.heapType.value}` : t.heapType.name;
    return `ref${t.nullable ? '?' : ''}:${h}`;
  }
  return t.toString(16);
}
