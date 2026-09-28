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
import { blockTypeOf, isRefValueType, recGroups, UNASSIGNED_TYPE_INDEX, varIndex } from './ir.ts';
import { ExprVisitor } from './expr-visitor.ts';
import { Result } from '../core/result.ts';
import type {
  BlockParams,
  BlockResult,
  FuncSignature,
  Module,
  TypeEntry,
  TypeUse,
  ValueType,
  Var,
} from './ir.ts';

const NO_LOC = { filename: '', line: 0, column: 0, offset: 0 };

/**
 * The IMPLICIT type for a signature: the index of an existing type that
 * denotes it, or a new one appended to `module.types`. The one rule for
 * "find or append", shared by the text parser — which interns every implicit
 * type in text order at the end of a module (W5) — and by
 * {@link synthesizeTypes}, which must find exactly what the parser appended so
 * that running it afterwards changes nothing.
 *
 * ONLY types that are their own rec group are candidates. An implicit type-use
 * denotes a SINGLETON rec group, and type identity is compared up to the rec
 * group — so a `(func)` sitting inside `(rec (type $a (func)) (type $b
 * (func)))` is a DIFFERENT type from a standalone `(func)`, and reusing it
 * silently gives the function a type the source did not write. `type-rec.wast`
 * asserts exactly this, with the comment ";; the implicit type of $f is not
 * $ft"; we were producing `(func (type $ft))` and every engine accepted the
 * result (T13). A singleton `(rec (type …))` counts as its own group and stays
 * reusable — it encodes differently from a bare `(type …)` but denotes the
 * same type.
 */
export function makeTypeInterner(module: Module): (sig: FuncSignature) => number {
  const sigToIdx = new Map<string, number>();
  const singleton = new Set<number>();
  for (const g of recGroups(module.types)) if (g.count === 1) singleton.add(g.start);
  for (const [i, te] of module.types.entries()) {
    if (te.kind === 'func' && singleton.has(i) && !sigToIdx.has(sigKey(te.sig))) {
      sigToIdx.set(sigKey(te.sig), i);
    }
  }
  return (sig: FuncSignature): number => {
    const key = sigKey(sig);
    const existing = sigToIdx.get(key);
    if (existing !== undefined) return existing;
    const idx = module.types.length;
    const entry: TypeEntry = { kind: 'func', name: '', sig, loc: NO_LOC };
    module.types.push(entry);
    sigToIdx.set(key, idx);
    return idx;
  };
}

/**
 * Walk `module.imports`, `module.functions`, and `module.tags`; ensure that
 * `module.types` contains a `func`-kind entry matching each item's
 * signature, and update each item's `typeVar` to point at the matching
 * type index.
 */
export function synthesizeTypes(module: Module): void {
  const ensureTypeFor = makeTypeInterner(module);

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
  // `typeVar` may be absent on the way in: this pass is what assigns it.
  const pending: { typeUse?: TypeUse; sig: FuncSignature; typeVar?: Var }[] = [];

  /** The item's written type while it still has the item's signature, else the interned one. */
  const keepOrIntern = (item: { sig: FuncSignature; typeVar?: Var }): Var => {
    const tv = item.typeVar;
    if (tv?.kind === 'index') {
      const entry = module.types[tv.value];
      if (entry?.kind === 'func' && sigKey(entry.sig) === sigKey(item.sig)) return tv;
    }
    return varIndex(ensureTypeFor(item.sig));
  };

  /**
   * A tag's type. Both writers write a tag's type as the FIRST function type
   * with its signature (`tagTypeIndex`), whatever `typeVar` says, so a type is
   * appended only when none exists. 🔧 It was always interned, and the interner
   * only reuses a type that is its own rec group — so a tag whose signature was
   * defined only inside a rec group got an extra, unused singleton type
   * (`spec/tag/tag.6.wasm`: two types in, three out). That neither writer keeps
   * WHICH of several matching types a tag named is a separate defect (Q9).
   */
  const settleTag = (tag: { sig: FuncSignature }): void => {
    const t = tag as { sig: FuncSignature; typeVar?: Var };
    t.typeVar = firstOrIntern(t.sig);
  };

  /**
   * The FIRST function type with `sig`, in any rec group, or an interned one
   * when none exists — the rule binaryen-ts's encoder derives a type by
   * (`gcFuncTypeIndex`). For what the TEXT never reaches: a tag, and a
   * `call_indirect` a pass built or whose written index was dropped as form.
   * 🔧 Interning alone reuses only a type that is its own rec group, so after
   * `-O1` every `call_indirect` of `spec/type-equivalence/type-equivalence.9.wasm`
   * — all its types in rec groups — got a NEW singleton type: a different type
   * for the engine's signature check (One front end stage 4, 2026-09-28).
   */
  const firstOrIntern = (sig: FuncSignature): Var => {
    const key = sigKey(sig);
    const first = module.types.findIndex((e) => e.kind === 'func' && sigKey(e.sig) === key);
    return varIndex(first >= 0 ? first : ensureTypeFor(sig));
  };

  const settle = (item: { typeUse?: TypeUse; sig: FuncSignature; typeVar?: Var }): void => {
    if (item.typeUse === 'resolved') return;
    if (item.typeUse !== undefined) {
      pending.push(item);
      return;
    }
    // An item that already NAMES a function type with its own signature keeps
    // it. A tree the binary reader built carries a `typeVar` and no `typeUse`
    // (that is text-only), and re-interning replaced a type inside a rec group
    // with a new singleton — a DIFFERENT type, so `(ref.func $f)` no longer had
    // the type its global declared and the module was invalid
    // (`spec/type-rec/type-rec.3.wasm`, One front end stage 4, 2026-09-28). It is
    // binaryen-ts's encoder's rule too: a written index is used while it still
    // matches — and one a pass made stale (a changed signature) is re-interned.
    item.typeVar = keepOrIntern(item);
  };

  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) settle(imp.func);
    else if (imp.kind === ExternalKind.Tag) {
      settleTag(imp.tag);
    }
  }

  for (const f of module.functions) settle(f);

  for (const tag of module.tags) {
    settleTag(tag);
  }

  // Instruction-level type-uses on `call_indirect`, tail-call variant included
  // (the same kind now, distinguished by `isReturn`),
  // collected from every body — including the bodies of funcs deferred above.
  const calls: { typeVar?: Var; sig: FuncSignature }[] = [];
  const collector = new ExprVisitor({
    onCallIndirectExpr: (e) => {
      // How the type was named is in the fidelity table, not on the node (S6
      // step 5 item 4 (a)). `settle` and the pending pass assign `typeVar`
      // through this view, which writes it back onto the node.
      const node = e as { typeVar?: Var; sig: FuncSignature };
      const typeUse = module.fidelity.get(e.nodeId)?.typeUse;
      calls.push(node);
      if (typeUse === undefined) {
        // No text behind it: a node the binary reader, a pass or the API made.
        // A written index is kept while it matches; otherwise the first match.
        const tv = node.typeVar;
        const entry = tv?.kind === 'index' ? module.types[tv.value] : undefined;
        if (entry?.kind === 'func' && sigKey(entry.sig) === sigKey(node.sig)) return Result.Ok;
        node.typeVar = firstOrIntern(node.sig);
        return Result.Ok;
      }
      settle({
        ...(typeUse !== undefined ? { typeUse } : {}),
        sig: e.sig,
        get typeVar(): Var {
          return node.typeVar ?? varIndex(0);
        },
        set typeVar(v: Var) {
          node.typeVar = v;
        },
      });
      return Result.Ok;
    },
  });
  for (const f of module.functions) collector.visitExprList(f.body.children);

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

  // A call_indirect that NAMED its type (`(type $t)`, no inline signature)
  // carries the type's signature too (M8a3). The parser left `sig` as the empty
  // inline one — a REQUIRED field saying `() -> ()` for a call whose type said
  // otherwise, on 222 corpus nodes. wabt-ts's own readers use `typeVar` and never
  // noticed; binaryen-ts reads `sig`, and the bridge was filling it. A reference
  // to a type that does not exist, or is not a function type, is left alone for
  // the validator to report.
  for (const call of calls) {
    const tv = call.typeVar;
    if (tv === undefined || tv.kind !== 'index') continue;
    const entry = module.types[tv.value];
    if (entry === undefined || entry.kind !== 'func') continue;
    call.sig = { params: [...entry.sig.params], results: [...entry.sig.results] };
  }

  // A block-type carrier whose header cannot be written inline — parameters, or
  // more than one result — and that names no type yet. The text parser settles
  // every one of these as it parses (implicit types in text order, W5), so on a
  // parsed tree this finds nothing and changes nothing. A tree the optimizer or
  // the API built has them: a pass makes a `(result i32 i32)` block with no
  // index, and the writer refused it — "block type has no type index yet"
  // (One front end stage 4, 2026-09-28). Appended LAST, after every type the
  // module already has, so no existing index moves.
  const carriers: {
    type: BlockResult;
    typeIndex?: number;
    params?: BlockParams;
  }[] = [];
  const note = (e: unknown): Result => {
    carriers.push(e as (typeof carriers)[number]);
    return Result.Ok;
  };
  const blocks = new ExprVisitor({
    beginBlockExpr: note,
    beginLoopExpr: note,
    beginIfExpr: note,
    beginTryExpr: note,
    beginTryTableExpr: note,
  });
  for (const f of module.functions) blocks.visitExprList(f.body.children);
  for (const c of carriers) {
    if (c.typeIndex !== undefined) continue;
    const shape = blockTypeOf(c);
    if (shape.kind !== 'func_type' || shape.typeIdx !== UNASSIGNED_TYPE_INDEX) continue;
    const results = c.type === 'none' ? [] : Array.isArray(c.type) ? [...c.type] : [c.type];
    c.typeIndex = ensureTypeFor({ params: [...(c.params?.types ?? [])], results });
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
