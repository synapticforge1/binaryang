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

import { ExternalKind } from '../core/binary.ts';
import { isRefValueType, recGroups, varIndex } from './ir.ts';
import { ExprVisitor } from './expr-visitor.ts';
import { Result } from '../core/result.ts';
import type { FuncSignature, Module, TypeEntry, TypeUse, ValueType, Var } from './ir.ts';

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
  //
  // ONLY types that are their own rec group are candidates. An implicit
  // type-use denotes a SINGLETON rec group, and type identity is compared up
  // to the rec group — so a `(func)` sitting inside `(rec (type $a (func))
  // (type $b (func)))` is a DIFFERENT type from a standalone `(func)`, and
  // reusing it silently gives the function a type the source did not write.
  // `type-rec.wast` asserts exactly this, with the comment ";; the implicit
  // type of $f is not $ft"; we were producing `(func (type $ft))` and every
  // engine accepted the result (T13). A singleton `(rec (type …))` counts as
  // its own group and stays reusable — it encodes differently from a bare
  // `(type …)` but denotes the same type.
  const singleton = new Set<number>();
  for (const g of recGroups(module.types)) if (g.count === 1) singleton.add(g.start);
  for (const [i, te] of module.types.entries()) {
    if (te.kind === 'func' && singleton.has(i)) sigToIdx.set(sigKey(te.sig), i);
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

  // Items the parser could not settle. Deferred for two different reasons,
  // both about INDEX ORDER: an item that references an existing type
  // contributes nothing to the section and must not have a spurious
  // `() -> ()` appended for it, and an item whose inline signature DEFINES a
  // type has to be appended after every explicit `(type …)` field, because the
  // spec puts implicit types after explicit ones and the testsuite depends on
  // it (`func.wast` writes `(type 1)` for an implicit entry).
  //
  // `typeUse === 'resolved'` is skipped entirely: the source named a type and
  // `typeVar` already points at it. Re-deriving the index from the signature
  // picks the wrong type whenever several share one — `(sub (func))` and
  // `(sub final (func))` are both `() -> ()`, and type-subtyping.wast has four
  // such types in a row.
  const pending: { typeUse?: TypeUse; sig: FuncSignature; typeVar: Var }[] = [];

  const settle = (item: { typeUse?: TypeUse; sig: FuncSignature; typeVar: Var }): void => {
    if (item.typeUse === 'resolved') return;
    if (item.typeUse !== undefined) {
      pending.push(item);
      return;
    }
    item.typeVar = varIndex(ensureTypeFor(item.sig));
  };

  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) settle(imp.func);
    else if (imp.kind === ExternalKind.Tag) {
      const idx = ensureTypeFor(imp.tag.sig);
      // Tags reuse the func-type encoding for their signature.
      (imp.tag as { typeVar?: ReturnType<typeof varIndex> }).typeVar = varIndex(idx);
    }
  }

  for (const f of module.funcs) settle(f);

  for (const tag of module.tags) {
    const idx = ensureTypeFor(tag.sig);
    (tag as { typeVar?: ReturnType<typeof varIndex> }).typeVar = varIndex(idx);
  }

  // Instruction-level type-uses (`call_indirect` / `return_call_indirect`),
  // collected from every body — including the bodies of funcs deferred above.
  const collector = new ExprVisitor({
    onCallIndirectExpr: (e) => {
      settle(e as unknown as typeof pending[number]);
      return Result.Ok;
    },
    onReturnCallIndirectExpr: (e) => {
      settle(e as unknown as typeof pending[number]);
      return Result.Ok;
    },
  });
  for (const f of module.funcs) collector.visitExprList(f.body);

  for (const item of pending) {
    const p = item.typeUse;
    // `settle` never pushes a 'resolved' item, but narrow rather than assert:
    // the guarantee lives in another function and could drift.
    if (p === undefined || p === 'resolved') continue;
    if (p === 'inline') {
      // The inline signature defines the type.
      item.typeVar = varIndex(ensureTypeFor(item.sig));
      continue;
    }
    const idx = p.kind === 'index' ? p.value : module.types.findIndex((t) => t.name === p.name);
    const entry = idx >= 0 ? module.types[idx] : undefined;
    if (entry === undefined || entry.kind !== 'func') {
      // The source named a type that does not exist. KEEP the index it wrote,
      // so the binary carries the dangling reference and the validator reports
      // it.
      //
      // This used to point at "an entry matching the (empty) signature", on
      // the reasoning that the validator would then report the dangling
      // reference — but that is not what it does. `ensureTypeFor` APPENDS a
      // matching type if none exists, so the result is a perfectly valid
      // module referring to some other type: `(func (type 42))` came out as
      // `(func (type 0))` and every engine accepted it. Six `assert_invalid`
      // "unknown type" modules were being repaired into validity this way
      // (T13). A name-form var that resolves to nothing is already reported by
      // `resolveNames`, so only the index form can reach here in practice.
      if (p.kind === 'index') item.typeVar = varIndex(p.value);
      continue;
    }
    item.sig.params.push(...entry.sig.params);
    item.sig.results.push(...entry.sig.results);
    item.typeVar = varIndex(idx);
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
