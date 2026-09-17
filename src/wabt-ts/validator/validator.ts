// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/validator.cc / include/wabt/validator.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import {
  blockResults,
  blockTypeOf,
  indexOf,
  isRefValueType,
  requireIndex,
  UNASSIGNED_TYPE_INDEX,
  valueTypeEquals,
} from '../ir/ir.ts';
import type { BlockType, Field, StorageType, TypeEntry, ValueType } from '../ir/ir.ts';
import { combineResults, Result } from '../core/result.ts';
import { ExternalKind } from '../core/binary.ts';
import {
  anyOpcodeName,
  MiscOpcode,
  OPCODE_I8X16_SHUFFLE,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import type { ErrorList, Location } from '../core/error.ts';
import type {
  ArrayCopyExpr,
  ArrayFillExpr,
  ArrayGetExpr,
  ArrayInitSegmentExpr,
  ArrayLenExpr,
  ArrayNewDataExpr,
  ArrayNewElemExpr,
  ArrayNewExpr,
  ArrayNewFixedExpr,
  ArraySetExpr,
  AtomicFenceExpr,
  AtomicLoadExpr,
  AtomicNotifyExpr,
  AtomicRmwCmpxchgExpr,
  AtomicRmwExpr,
  AtomicStoreExpr,
  AtomicWaitExpr,
  BinaryExpr,
  BlockExpr,
  BrExpr,
  BrOnExpr,
  BrTableExpr,
  CallExpr,
  CallIndirectExpr,
  CallRefExpr,
  Catch,
  CodeMetadataExpr,
  ConstExpr,
  DataDropExpr,
  DropExpr,
  ElemDropExpr,
  Expr,
  ExternConvertExpr,
  GlobalGetExpr,
  GlobalSetExpr,
  I31GetExpr,
  IfExpr,
  LoadExpr,
  LoadSplatExpr,
  LocalGetExpr,
  LocalSetExpr,
  LocalTeeExpr,
  LoopExpr,
  MemoryCopyExpr,
  MemoryFillExpr,
  MemoryGrowExpr,
  MemoryInitExpr,
  MemorySizeExpr,
  Module,
  NopExpr,
  QuaternaryExpr,
  RefAsNonNullExpr,
  RefCastExpr,
  RefEqExpr,
  RefFuncExpr,
  RefI31Expr,
  RefIsNullExpr,
  RefNullExpr,
  RefTestExpr,
  RethrowExpr,
  ReturnExpr,
  SelectExpr,
  SimdExtractExpr,
  SimdLoadLaneExpr,
  SimdReplaceExpr,
  SimdShuffleOpExpr,
  StoreExpr,
  StructGetExpr,
  StructNewExpr,
  StructSetExpr,
  TableCopyExpr,
  TableFillExpr,
  TableGetExpr,
  TableGrowExpr,
  TableInitExpr,
  TableSetExpr,
  TableSizeExpr,
  TernaryExpr,
  ThrowExpr,
  ThrowRefExpr,
  TryExpr,
  TryTableExpr,
  UnaryExpr,
  UnreachableExpr,
  Var,
} from '../ir/ir.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { SharedValidator } from './shared-validator.ts';
import type { ValidateOptions } from './shared-validator.ts';
import { BrOnOp, locOf } from '../ir/ir.ts';

/**
 * Canonical structural keys for every type-section entry.
 *
 * WebAssembly type identity is STRUCTURAL, not by index: two `(type (func))`
 * declarations are one type, and a `(ref $a)` is accepted where a `(ref $b)`
 * is wanted when their definitions match. Comparing indices alone rejected
 * every module in type-equivalence.wast.
 *
 * Recursion is handled the way the spec does it — a reference to a member of
 * the SAME rec group is written as its position within the group, so two
 * groups that are shaped alike key alike no matter what indices they occupy.
 * References out of the group name the target's own key, which terminates
 * because a group can only reference itself or an EARLIER group.
 */
function canonicalTypeKeys(types: readonly TypeEntry[]): string[] {
  // Which rec group each index belongs to. `recGroupSize` is set on the first
  // entry of an explicit `(rec …)`; anything else is a group of one.
  const groupStart = new Array<number>(types.length).fill(0);
  const groupSize = new Array<number>(types.length).fill(1);
  for (let i = 0; i < types.length;) {
    const size = types[i]?.recGroupSize ?? 1;
    for (let k = 0; k < size && i + k < types.length; k++) {
      groupStart[i + k] = i;
      groupSize[i + k] = size;
    }
    i += Math.max(1, size);
  }

  const memo = new Array<string | undefined>(types.length).fill(undefined);
  const inProgress = new Set<number>();

  const keyOf = (i: number): string => {
    const cached = memo[i];
    if (cached !== undefined) return cached;
    // A malformed module can point a group at itself through a path this
    // walk did not expect; fall back to the index rather than recurse.
    if (inProgress.has(i)) return `?${i}`;
    inProgress.add(i);
    const start = groupStart[i]!;
    const size = groupSize[i]!;
    const members: string[] = [];
    for (let k = 0; k < size && start + k < types.length; k++) {
      members.push(structKey(types[start + k]!, start, size));
    }
    const groupKey = members.join('|');
    for (let k = 0; k < size && start + k < types.length; k++) {
      memo[start + k] = `${groupKey}#${k}`;
    }
    inProgress.delete(i);
    return memo[i] ?? `?${i}`;
  };

  const vtKey = (vt: StorageType, start: number, size: number): string => {
    if (!isRefValueType(vt)) return `t${vt.toString(16)}`;
    const h = vt.heapType;
    const n = vt.nullable ? '?' : '!';
    if (h.kind !== 'index') return `${n}a:${h.name}`;
    if (h.value >= start && h.value < start + size) return `${n}r:${h.value - start}`;
    return `${n}k:${keyOf(h.value)}`;
  };

  const fieldKey = (f: Field, start: number, size: number): string =>
    `${f.mutable ? 'm' : 'c'}${vtKey(f.type, start, size)}`;

  function structKey(te: TypeEntry, start: number, size: number): string {
    // A supertype inside the SAME rec group has to be keyed by position too,
    // exactly like a field reference. Keying it by `keyOf` recurses into the
    // group being built, hits the in-progress guard, and bakes a raw index
    // into the key — which made two structurally identical rec groups
    // (type-subtyping.wast) come out with different keys.
    const superKey = (sv: Var): string => {
      if (sv.kind !== 'index') return sv.name;
      return sv.value >= start && sv.value < start + size
        ? `r:${sv.value - start}`
        : `k:${keyOf(sv.value)}`;
    };
    const sub = te.sub === undefined
      ? 'F'
      : `${te.sub.final ? 'F' : 'N'}[${te.sub.supertypes.map(superKey).join(',')}]`;
    if (te.kind === 'func') {
      return `${sub}func(${te.sig.params.map((p) => vtKey(p, start, size)).join(',')})->(${
        te.sig.results.map((r) => vtKey(r, start, size)).join(',')
      })`;
    }
    if (te.kind === 'struct') {
      return `${sub}struct(${te.fields.map((f) => fieldKey(f, start, size)).join(',')})`;
    }
    return `${sub}array(${te.field ? fieldKey(te.field, start, size) : ''})`;
  }

  return types.map((_, i) => keyOf(i));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Validates a decoded WebAssembly module, appending errors to {@link errors}.
 *  Returns Result.Ok if valid, Result.Error otherwise. */
export function validateModule(
  module: Module,
  errors: ErrorList,
  options?: ValidateOptions,
): Result {
  const v = new ModuleValidator(module, errors, options);
  return v.checkModule();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Every {@link BlockType} appearing anywhere in an expression list.
 *
 * Walks generically over child expression arrays rather than switching on kind,
 * because the point is to miss NOTHING: a new control construct must be covered
 * the day it is added, not the day someone remembers to extend a switch. That is
 * the same reasoning behind `walkExpression` throwing on an unhandled kind, and
 * the opposite of what let this check go missing in the first place.
 */
const CARRIER_KINDS: ReadonlySet<string> = new Set(['block', 'loop', 'if', 'try', 'try_table']);

function blockTypesIn(exprs: readonly unknown[]): BlockType[] {
  const out: BlockType[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const rec = node as Record<string, unknown>;
    // 🔧 This keyed on a `blockType` FIELD. Stage (c2) removed it, and a missing
    // key is not an error — the walk would have found nothing, silently, and let
    // `(block (result (ref 1)))` in a one-type module through again. It asks a
    // carrier for its header instead.
    if (typeof rec['kind'] === 'string' && CARRIER_KINDS.has(rec['kind'])) {
      out.push(blockTypeOf(node as BlockExpr));
    }
    for (const value of Object.values(rec)) {
      if (value !== null && typeof value === 'object') visit(value);
    }
  };
  visit(exprs);
  return out;
}

function varIdx(v: Var): number {
  return requireIndex(v, 'validator');
}

// ---------------------------------------------------------------------------
// ModuleValidator — walks the IR and calls SharedValidator
// ---------------------------------------------------------------------------

class ModuleValidator implements ExprVisitorDelegate {
  private sv: SharedValidator;
  private module: Module;
  private result: Result = Result.Ok;

  constructor(module: Module, errors: ErrorList, options?: ValidateOptions) {
    this.module = module;
    this.sv = new SharedValidator(errors, options);
  }

  // -------------------------------------------------------------------------
  // Module-level traversal
  // -------------------------------------------------------------------------

  checkModule(): Result {
    const m = this.module;
    const loc = m.loc;

    // Types. The declared `(sub $Super …)` list travels with each entry so the
    // TypeChecker can answer `$A <: $B` for DEFINED types (T9.3); it used to
    // be dropped here, and every concrete ref was coarsened anyway.
    const canon = canonicalTypeKeys(m.types);
    for (const [i, te] of m.types.entries()) {
      const supers = (te.sub?.supertypes ?? [])
        // An unresolved supertype is SKIPPED rather than defaulted; the -1
        // sentinel this replaces said the same thing less clearly.
        .map(indexOf)
        .filter((n): n is number => n !== undefined);
      const c = canon[i] ?? '';
      if (te.kind === 'func') {
        this.acc(this.sv.onFuncType(te.loc, te.sig.params, te.sig.results, i, supers, c));
      } else if (te.kind === 'struct') {
        this.acc(this.sv.onStructType(te.loc, te.fields, supers, c));
      } else {
        this.acc(this.sv.onArrayType(te.loc, te.field, supers, c));
      }
    }

    // Subtyping depth is capped at 63 by the GC proposal so a subtype check can
    // be O(1); both Wasmtime and V8 enforce it. Checked here rather than inside
    // the loop above because a type may name a supertype declared later in its
    // own rec group (T13.34).
    this.acc(this.sv.checkSubtypingDepth(loc));

    // Every heap-type index in the module must name a real type. This has to
    // run AFTER the whole type section is declared — a type may legally
    // reference one defined later.
    const seenTypes = m.types.length;
    const checkVt = (vt: StorageType, what: string, loc: Location, bound?: number): void => {
      this.acc(this.sv.checkValueType(loc, vt, what, bound));
    };
    // How far each type may reach: everything before it, plus the remainder of
    // its own rec group.
    const scopeEnd = new Array<number>(m.types.length).fill(0);
    for (let i = 0; i < m.types.length;) {
      const size = Math.max(1, m.types[i]?.recGroupSize ?? 1);
      for (let k = 0; k < size && i + k < m.types.length; k++) scopeEnd[i + k] = i + size;
      i += size;
    }
    for (const [i, te] of m.types.entries()) {
      const bound = scopeEnd[i] ?? seenTypes;
      if (te.kind === 'func') {
        for (const p of te.sig.params) checkVt(p, `type ${i} param`, te.loc, bound);
        for (const r of te.sig.results) checkVt(r, `type ${i} result`, te.loc, bound);
      } else if (te.kind === 'struct') {
        for (const f of te.fields) checkVt(f.type, `type ${i} field`, te.loc, bound);
      } else if (te.field) {
        checkVt(te.field.type, `type ${i} element`, te.loc, bound);
      }
      for (const sv of te.sub?.supertypes ?? []) {
        if (sv.kind !== 'index') continue;
        if (sv.value >= seenTypes) {
          this.acc(this.sv.onUnknownType(te.loc, sv.value));
          continue;
        }
        // A FINAL type cannot be extended. Absent `(sub …)` means implicitly
        // final, so a bare `(type (func))` is final too — which is why
        // `(type $a (func)) (type $b (sub 0 (func)))` is invalid even though
        // nothing says "final" anywhere in it.
        const superEntry = m.types[sv.value];
        if (superEntry === undefined) continue;
        if (superEntry.sub === undefined || superEntry.sub.final) {
          this.acc(this.sv.onFinalSupertype(te.loc, i, sv.value));
          continue;
        }
        this.checkSubtypeDecl(te, superEntry, i, sv.value);
      }
    }
    for (const g of m.globals) checkVt(g.type, 'global', g.loc);
    for (const t of m.tables) checkVt(t.elemType, 'table', t.loc);
    for (const el of m.elements) checkVt(el.elemType, 'elem segment', el.loc);
    for (const f of m.functions) {
      for (const p of f.sig.params) checkVt(p, 'param', f.loc);
      for (const r of f.sig.results) checkVt(r, 'result', f.loc);
      for (const l of f.locals.slice(f.sig.params.length)) checkVt(l.type, 'local', f.loc);
      // ⚠️ And the BLOCK TYPES inside the body, which this loop used to miss.
      //
      // A `(block (result (ref 1)))` in a module whose type section has one
      // entry names a type that does not exist, and the spec requires the module
      // to be rejected with "unknown type". Every OTHER place a value type can
      // appear was checked — params, results, locals, globals, tables, elem
      // segments, and the type section itself — so a `(local (ref null 1))` was
      // correctly refused while the block form went straight through.
      //
      // Found by the spec testsuite (`ref.wast:65,69`), and it is the failure
      // mode nothing else here could see: ACCEPTING something invalid. Every
      // other invariant in this project asks only whether valid input survives.
      for (const bt of blockTypesIn(f.body.children)) {
        if (bt.kind === 'value') checkVt(bt.type, 'block result', f.loc);
      }
    }

    // Imports
    let funcImportIdx = 0;
    for (const imp of m.imports) {
      switch (imp.kind) {
        case ExternalKind.Func: {
          const sigIdx = varIdx(imp.func.typeVar);
          this.acc(this.sv.onFunction(imp.func.loc, sigIdx));
          funcImportIdx++;
          break;
        }
        case ExternalKind.Table:
          this.acc(this.sv.onTable(imp.table.loc, imp.table.elemType, imp.table.limits));
          break;
        case ExternalKind.Memory:
          this.acc(this.sv.onMemory(imp.memory.loc, imp.memory.limits));
          break;
        case ExternalKind.Global:
          this.acc(this.sv.onGlobalImport(imp.global.loc, imp.global.type, imp.global.mutable));
          break;
        case ExternalKind.Tag:
          // A tag's type is the func type with the same params and no results.
          // Resolve it the same way as a defined tag rather than assuming
          // index 0 (which silently mis-typed any non-first tag signature).
          this.acc(
            this.sv.onTag(
              imp.tag.loc,
              this.resolveTagSig(imp.tag.sig.params, imp.tag.sig.results),
            ),
          );
          break;
      }
    }

    // Defined functions (type registration only; bodies come later)
    for (const func of m.functions) {
      this.acc(this.sv.onFunction(func.loc, varIdx(func.typeVar)));
    }

    // Tables
    for (const table of m.tables) {
      // PRESENT, not non-empty: an empty initializer is one — and invalid, so the
      // validator must see it rather than a table without one (M2).
      this.acc(this.sv.onTable(table.loc, table.elemType, table.limits, table.init !== undefined));
      if (table.init !== undefined) {
        this.acc(this.sv.beginInitExpr(table.loc, table.elemType));
        this.visitConstExpr(table.init.children, table.loc);
        this.acc(this.sv.endInitExpr());
      }
    }

    // Memories
    for (const mem of m.memories) {
      this.acc(this.sv.onMemory(mem.loc, mem.limits));
    }

    // Globals. `onGlobal` registers it first, so the in-scope count for its
    // OWN initializer is one less than the total — a global cannot name
    // itself.
    let globalIdx = m.numGlobalImports;
    for (const global of m.globals) {
      this.acc(this.sv.onGlobal(global.loc, global.type, global.mutable));
      this.acc(this.sv.beginGlobalInitExpr(global.loc, global.type, globalIdx++));
      // A defined global with no initializer is checked as an empty one: invalid.
      this.visitConstExpr(global.init?.children ?? [], global.loc);
      this.acc(this.sv.endInitExpr());
    }

    // Tags
    for (const tag of m.tags) {
      const sigIdx = this.resolveTagSig(tag.sig.params, tag.sig.results);
      this.acc(this.sv.onTag(tag.loc, sigIdx));
    }

    // Exports
    for (const exp of m.exports) {
      this.acc(this.sv.onExport(loc, exp.kind, varIdx(exp.var), exp.name));
    }

    // Start
    if (m.start !== undefined) {
      this.acc(this.sv.onStart(loc, varIdx(m.start)));
    }

    // Elem segments
    for (const elem of m.elements) {
      this.acc(this.sv.onElemSegment(elem.loc, varIdx(elem.tableVar), elem.kind));
      this.acc(this.sv.onElemSegmentElemType(elem.loc, elem.elemType));
      if (elem.kind === 'active') {
        // An active segment's offset is indexed in the TABLE's index type —
        // i64 for a table64 table. Hard-coding i32 rejected every 64-bit
        // active segment with "type mismatch in function".
        const offsetType = this.sv.tableIndexType(varIdx(elem.tableVar));
        this.acc(this.sv.beginInitExpr(elem.loc, offsetType));
        this.visitConstExpr(elem.offset?.children ?? [], elem.loc);
        this.acc(this.sv.endInitExpr());
      }
      for (const elemExpr of elem.elemExprs) {
        this.acc(this.sv.beginInitExpr(elem.loc, elem.elemType));
        this.visitConstExpr(elemExpr.children, elem.loc);
        this.acc(this.sv.endInitExpr());
      }
    }

    // Data count
    this.sv.onDataCount(m.dataSegments.length);

    // Function bodies
    const visitor = new ExprVisitor(this);
    let globalFuncIdx = m.numFuncImports;
    for (const func of m.functions) {
      this.acc(this.sv.beginFunctionBody(func.loc, globalFuncIdx++));
      // One declaration per slot: the shared validator counts locals, and the
      // grouping the binary used is the writer's business (M6c).
      for (const local of func.locals.slice(func.sig.params.length)) {
        this.acc(this.sv.onLocalDecl(func.loc, 1, local.type));
      }
      this.acc(visitor.visitExprList(func.body.children));
      this.acc(this.sv.endFunctionBody(func.loc));
    }

    // Data segments (init offsets)
    for (const seg of m.dataSegments) {
      this.acc(this.sv.onDataSegment(seg.loc, varIdx(seg.memoryVar), seg.kind));
      if (seg.kind === 'active') {
        // Same for data: the offset is in the MEMORY's index type.
        this.acc(this.sv.beginInitExpr(seg.loc, this.sv.memoryIndexType(varIdx(seg.memoryVar))));
        this.visitConstExpr(seg.offset?.children ?? [], seg.loc);
        this.acc(this.sv.endInitExpr());
      }
    }

    this.acc(this.sv.endModule());
    return this.result;
  }

  /**
   * A constant expression may only use a restricted instruction set: the
   * `*.const` family, `ref.null` / `ref.func`, `global.get`, the
   * extended-const arithmetic (`i32`/`i64` add, sub, mul), and the GC
   * allocation forms. Nothing enforced that, so
   * `(data (offset i32.const 0 i32.ctz) "")` validated clean.
   *
   * Written as an explicit recursion over the ALLOWED shapes rather than a
   * generic walk: anything not on the list is rejected on sight, so there is
   * no need to descend into it.
   */
  private isConstExpr(e: Expr): boolean {
    switch (e.kind) {
      case 'const':
      case 'ref.null':
      case 'ref.func':
      case 'global.get':
        return true;
      case 'binary': {
        // extended-const: only add / sub / mul on i32 / i64.
        const name = anyOpcodeName(e.opcode) ?? '';
        if (!/^i(32|64)\.(add|sub|mul)$/.test(name)) return false;
        return this.isConstExpr(e.left) && this.isConstExpr(e.right);
      }
      case 'ref.i31':
        return this.isConstExpr(e.value);
      case 'any.convert_extern':
      case 'extern.convert_any':
        return this.isConstExpr(e.value);
      case 'struct.new':
      case 'array.new_fixed':
        // The default form has no operands, so `every` is vacuously true --
        // which is the right answer, and why it needs no separate case.
        return e.operands.every((x) => this.isConstExpr(x));
      case 'array.new':
        return (e.init === undefined || this.isConstExpr(e.init)) && this.isConstExpr(e.length);
      default:
        return false;
    }
  }

  /** Validate a constant expression's instruction set, then its types. */
  private visitConstExpr(exprs: Expr[], loc: Location): void {
    for (const e of exprs) {
      if (!this.isConstExpr(e)) {
        this.acc(this.sv.onNonConstExpr(loc, e.kind));
        break;
      }
    }
    this.visitExprList(exprs);
  }

  /**
   * Check that a declared `(sub $Super)` relationship actually holds.
   *
   * Only the FINALITY rule was enforced (T9.6); the structure was never
   * compared, so `(type $a (sub (struct (field i32))))` could be extended by
   * a type with a different field type, or by a func type entirely. The
   * variance rules are the usual ones:
   *
   *   func    params CONTRAvariant, results COvariant
   *   struct  the subtype must keep every field, in order, and may append;
   *           a mutable field must match exactly, an immutable one may be
   *           narrowed
   *   array   the element behaves like a single struct field
   */
  private checkSubtypeDecl(sub: TypeEntry, superT: TypeEntry, i: number, j: number): void {
    const bad = (why: string) => this.acc(this.sv.onBadSubtype(sub.loc, i, j, why));
    if (sub.kind !== superT.kind) {
      bad(`${sub.kind} cannot extend ${superT.kind}`);
      return;
    }
    const fieldOk = (a: Field, b: Field): boolean =>
      b.mutable
        // A mutable slot is read AND written through the supertype, so it has
        // to match exactly — narrowing it would break writes.
        ? a.mutable && this.sv.isSubtype(a.type, b.type) && this.sv.isSubtype(b.type, a.type)
        : !a.mutable && this.sv.isSubtype(a.type, b.type);

    if (sub.kind === 'func' && superT.kind === 'func') {
      const sp = sub.sig.params, pp = superT.sig.params;
      const sr = sub.sig.results, pr = superT.sig.results;
      if (sp.length !== pp.length || sr.length !== pr.length) {
        bad('arity differs');
        return;
      }
      for (const [k, p] of pp.entries()) {
        if (!this.sv.isSubtype(p, sp[k]!)) return void bad(`param ${k} is not contravariant`);
      }
      for (const [k, r] of sr.entries()) {
        if (!this.sv.isSubtype(r, pr[k]!)) return void bad(`result ${k} is not covariant`);
      }
    } else if (sub.kind === 'struct' && superT.kind === 'struct') {
      if (sub.fields.length < superT.fields.length) return void bad('drops a field');
      for (const [k, f] of superT.fields.entries()) {
        if (!fieldOk(sub.fields[k]!, f)) return void bad(`field ${k} does not match`);
      }
    } else if (sub.kind === 'array' && superT.kind === 'array') {
      if (!sub.field || !superT.field) return;
      if (!fieldOk(sub.field, superT.field)) bad('element does not match');
    }
  }

  private acc(r: Result): void {
    this.result = combineResults(this.result, r);
  }

  private visitExprList(exprs: Expr[]): void {
    const visitor = new ExprVisitor(this);
    this.acc(visitor.visitExprList(exprs));
  }

  private resolveTagSig(params: ValueType[], results: ValueType[]): number {
    for (const [i, te] of this.module.types.entries()) {
      if (
        te.kind === 'func' &&
        te.sig.params.length === params.length &&
        te.sig.results.length === results.length &&
        te.sig.params.every((t, j) => t === params[j]) &&
        te.sig.results.every((t, j) => t === results[j])
      ) {
        return i;
      }
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // ExprVisitorDelegate — one method per expression kind
  // -------------------------------------------------------------------------

  onNopExpr(e: NopExpr): Result {
    return this.sv.onNop(locOf(e));
  }
  onUnreachableExpr(e: UnreachableExpr): Result {
    return this.sv.onUnreachable(locOf(e));
  }

  onReturnExpr(e: ReturnExpr): Result {
    return this.sv.onReturn(locOf(e));
  }
  onDropExpr(e: DropExpr): Result {
    return this.sv.onDrop(locOf(e));
  }

  onSelectExpr(e: SelectExpr): Result {
    return this.sv.onSelect(locOf(e), e.resultType);
  }

  /**
   * A carrier's header as it will be WRITTEN, checked against the node's own
   * signature (S6 step 5, stage (c2)).
   *
   * The node holds its signature — `type` and `params.types` — AND, where the
   * header named one, the type index (`typeIndex`, form). Those are two
   * spellings of one fact, and the writers emit the INDEX: a node whose index
   * named a different signature would type-check here against one program and
   * be written as another. So they must agree, and a header with no index must
   * have an inline spelling — no parameters, at most one result.
   */
  private checkCarrierHeader(e: BlockExpr | LoopExpr | IfExpr | TryExpr | TryTableExpr): Result {
    const bt = blockTypeOf(e);
    if (bt.kind !== 'func_type') return Result.Ok;
    if (bt.typeIdx === UNASSIGNED_TYPE_INDEX) {
      return this.sv.printError(
        locOf(e),
        `${e.kind}: a header with parameters or several results needs a type index, and has none`,
      );
    }
    const entry = this.module.types[bt.typeIdx];
    if (entry === undefined || entry.kind !== 'func') return Result.Ok; // reported by the header check
    const params = e.params?.types ?? [];
    const results = blockResults(e.type);
    const same = (a: readonly ValueType[], b: readonly ValueType[]) =>
      a.length === b.length && a.every((x, i) => valueTypeEquals(x, b[i]!));
    if (!same(params, entry.sig.params) || !same(results, entry.sig.results)) {
      return this.sv.printError(
        locOf(e),
        `${e.kind}: its signature does not match type ${bt.typeIdx}, which its header names`,
      );
    }
    return Result.Ok;
  }

  beginBlockExpr(e: BlockExpr): Result {
    return combineResults(this.checkCarrierHeader(e), this.sv.onBlock(locOf(e), blockTypeOf(e)));
  }
  endBlockExpr(e: BlockExpr): Result {
    return this.sv.onEnd(locOf(e));
  }
  beginLoopExpr(e: LoopExpr): Result {
    return combineResults(this.checkCarrierHeader(e), this.sv.onLoop(locOf(e), blockTypeOf(e)));
  }
  endLoopExpr(e: LoopExpr): Result {
    return this.sv.onEnd(locOf(e));
  }
  beginIfExpr(e: IfExpr): Result {
    let r = combineResults(this.checkCarrierHeader(e), this.sv.onIf(locOf(e), blockTypeOf(e)));
    // A missing `else` is not modelled anywhere else, so the arity rule for a
    // one-armed if has to be checked from the IR.
    if (e.ifFalse === null) {
      r = combineResults(r, this.sv.onOneArmedIf(locOf(e), blockTypeOf(e)));
    }
    return r;
  }
  afterIfTrueExpr(e: IfExpr): Result {
    return e.ifFalse !== null ? this.sv.onElse(locOf(e)) : Result.Ok;
  }
  endIfExpr(e: IfExpr): Result {
    return this.sv.onEnd(locOf(e));
  }

  onBrExpr(e: BrExpr): Result {
    // A `br` carrying a condition IS `br_if`; the opcode follows the field.
    return e.condition !== undefined
      ? this.sv.onBrIf(locOf(e), varIdx(e.target))
      : this.sv.onBr(locOf(e), varIdx(e.target));
  }
  onBrOnExpr(e: BrOnExpr): Result {
    // The null pair is typed function references; the cast pair is GC.
    // One node, two feature gates, chosen by the sub-op.
    if (e.opcode === BrOnOp.Null || e.opcode === BrOnOp.NonNull) {
      const rn = this.sv.requireFeature(
        'functionReferences',
        'typed function reference',
        locOf(e),
      );
      if (rn !== Result.Ok) this.acc(rn);
      return e.opcode === BrOnOp.Null
        ? this.sv.onBrOnNull(locOf(e), varIdx(e.target))
        : this.sv.onBrOnNonNull(locOf(e), varIdx(e.target));
    }
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onBrOnCast(
      locOf(e),
      varIdx(e.target),
      e.opcode === BrOnOp.CastFail,
      { heapType: e.from!.heapType, nullable: e.from!.nullable },
      { heapType: e.to!.heapType, nullable: e.to!.nullable },
    );
  }

  onBrTableExpr(e: BrTableExpr): Result {
    let r = this.sv.beginBrTable(locOf(e));
    for (const t of e.targets) {
      r = combineResults(r, this.sv.onBrTableTarget(locOf(e), varIdx(t)));
    }
    r = combineResults(r, this.sv.onBrTableTarget(locOf(e), varIdx(e.defaultTarget)));
    r = combineResults(r, this.sv.endBrTable(locOf(e)));
    return r;
  }

  onConstExpr(e: ConstExpr): Result {
    return this.sv.onConst(locOf(e), e.value.type);
  }

  onLocalGetExpr(e: LocalGetExpr): Result {
    return this.sv.onLocalGet(locOf(e), varIdx(e.var));
  }
  onLocalSetExpr(e: LocalSetExpr): Result {
    return this.sv.onLocalSet(locOf(e), varIdx(e.var));
  }
  onLocalTeeExpr(e: LocalTeeExpr): Result {
    return this.sv.onLocalTee(locOf(e), varIdx(e.var));
  }
  onGlobalGetExpr(e: GlobalGetExpr): Result {
    return this.sv.onGlobalGet(locOf(e), varIdx(e.var));
  }
  onGlobalSetExpr(e: GlobalSetExpr): Result {
    return this.sv.onGlobalSet(locOf(e), varIdx(e.var));
  }

  /**
   * Gate the proposals that are keyed by OPCODE rather than by a dedicated
   * hook, so they cannot be reached through the generic arithmetic handlers.
   *
   * Three of the nine ungated proposals had no handler of their own:
   * relaxed SIMD and wide arithmetic are ordinary unary/binary/ternary nodes
   * distinguished only by their opcode, and extended-const is ordinary
   * arithmetic distinguished only by APPEARING IN AN INITIALIZER. A gate hung
   * off an expression kind would have missed all three (T13.10).
   */
  private gateOpcode(op: number, loc: Location): void {
    if ((op >>> 16) === PREFIX_SIMD && (op & 0xffff) >= 0x100) {
      // Relaxed-SIMD sub-opcodes are the ones at or above 0x100 — the same
      // boundary that forced the `<< 16` opcode packing (T7.7).
      this.acc(this.sv.requireFeature('relaxedSimd', 'relaxed SIMD instruction', loc));
    } else if ((op >>> 16) === PREFIX_MISC) {
      const sub = op & 0xffff;
      if (sub >= MiscOpcode.I64Add128 && sub <= MiscOpcode.I64MulWideU) {
        this.acc(this.sv.requireFeature('wideArithmetic', 'wide arithmetic instruction', loc));
      }
    }
    if (this.sv.inInitExpr) {
      // Arithmetic is constant only under extended-const; the MVP constant
      // expressions are `*.const`, `global.get` and the `ref.*` forms.
      this.acc(this.sv.requireFeature('extendedConst', 'arithmetic in a constant expression', loc));
    }
  }

  onUnaryExpr(e: UnaryExpr): Result {
    this.gateOpcode(e.opcode as unknown as number, locOf(e));
    return this.sv.onUnary(locOf(e), e.opcode);
  }
  onBinaryExpr(e: BinaryExpr): Result {
    this.gateOpcode(e.opcode as unknown as number, locOf(e));
    return this.sv.onBinary(locOf(e), e.opcode);
  }
  onTernaryExpr(e: TernaryExpr): Result {
    this.gateOpcode(e.opcode as unknown as number, locOf(e));
    return this.sv.onTernary(locOf(e), e.opcode);
  }
  onQuaternaryExpr(e: QuaternaryExpr): Result {
    this.gateOpcode(e.opcode as unknown as number, locOf(e));
    return this.sv.onQuaternary(locOf(e), e.opcode);
  }

  onLoadExpr(e: LoadExpr): Result {
    return this.sv.onLoad(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onStoreExpr(e: StoreExpr): Result {
    return this.sv.onStore(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }

  onMemorySizeExpr(e: MemorySizeExpr): Result {
    return this.sv.onMemorySize(locOf(e), varIdx(e.memidx));
  }
  onMemoryGrowExpr(e: MemoryGrowExpr): Result {
    return this.sv.onMemoryGrow(locOf(e), varIdx(e.memidx));
  }
  onMemoryCopyExpr(e: MemoryCopyExpr): Result {
    return this.sv.onMemoryCopy(locOf(e), varIdx(e.destMemidx), varIdx(e.srcMemidx));
  }
  onMemoryFillExpr(e: MemoryFillExpr): Result {
    return this.sv.onMemoryFill(locOf(e), varIdx(e.memidx));
  }
  onMemoryInitExpr(e: MemoryInitExpr): Result {
    return this.sv.onMemoryInit(locOf(e), varIdx(e.segment), varIdx(e.memidx));
  }
  onDataDropExpr(e: DataDropExpr): Result {
    return this.sv.onDataDrop(locOf(e), varIdx(e.segment));
  }

  /**
   * ⚠️ A tail call is a different instruction to the validator, not just a
   * different opcode: it needs the `tailCall` feature and a different
   * type-checker entry point, because it must match the FUNCTION's results
   * rather than leaving its own on the stack.
   */
  onCallExpr(e: CallExpr): Result {
    if (!e.isReturn) return this.sv.onCall(locOf(e), varIdx(e.func));
    const rf = this.sv.requireFeature('tailCall', 'tail call', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onReturnCall(locOf(e), varIdx(e.func));
  }
  onCallIndirectExpr(e: CallIndirectExpr): Result {
    // An inline signature is interned by `synthesizeTypes`; a node that reaches
    // here without a type has nothing the writer could encode.
    if (e.typeVar === undefined) {
      return this.sv.printError(locOf(e), 'call_indirect: no type index (run synthesizeTypes)');
    }
    if (!e.isReturn) return this.sv.onCallIndirect(locOf(e), varIdx(e.typeVar), varIdx(e.table));
    const rf = this.sv.requireFeature('tailCall', 'tail call', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onReturnCallIndirect(locOf(e), varIdx(e.typeVar), varIdx(e.table));
  }
  onCallRefExpr(e: CallRefExpr): Result {
    const rf = this.sv.requireFeature('functionReferences', 'typed function reference', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    if (!e.isReturn) return this.sv.onCallRef(locOf(e), varIdx(e.sigType));
    const rt = this.sv.requireFeature('tailCall', 'tail call', locOf(e));
    if (rt !== Result.Ok) this.acc(rt);
    return this.sv.onReturnCallRef(locOf(e), varIdx(e.sigType));
  }

  onRefNullExpr(e: RefNullExpr): Result {
    // `refType` is a HEAP type, and `ref.null H` produces `(ref null H)`.
    // A user-defined `$T` used to coarsen to the abstract supertype of its
    // entry, which lost which type it was; it now travels as an index.
    return this.sv.onRefNull(locOf(e), { heapType: e.refType, nullable: true });
  }

  onRefIsNullExpr(e: RefIsNullExpr): Result {
    return this.sv.onRefIsNull(locOf(e));
  }
  onRefFuncExpr(e: RefFuncExpr): Result {
    return this.sv.onRefFunc(locOf(e), varIdx(e.func));
  }
  onRefAsNonNullExpr(e: RefAsNonNullExpr): Result {
    const rf = this.sv.requireFeature('functionReferences', 'typed function reference', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onRefAsNonNull(locOf(e));
  }
  onRefEqExpr(e: RefEqExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onRefEq(locOf(e));
  }
  onRefI31Expr(e: RefI31Expr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onRefI31(locOf(e));
  }
  onExternConvertExpr(e: ExternConvertExpr): Result {
    return this.sv.onExternConvert(locOf(e), e.kind === 'any.convert_extern');
  }
  onI31GetExpr(e: I31GetExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onI31Get(locOf(e));
  }
  onStructNewExpr(e: StructNewExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    // The default form checks nothing about field values, because there are none.
    return e.defaultInit
      ? this.sv.onStructNewDefault(locOf(e), varIdx(e.typeVar))
      : this.sv.onStructNew(locOf(e), varIdx(e.typeVar));
  }
  onStructGetExpr(e: StructGetExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onStructGet(locOf(e), varIdx(e.typeVar), varIdx(e.fieldVar), e.signed);
  }
  onStructSetExpr(e: StructSetExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onStructSet(locOf(e), varIdx(e.typeVar), varIdx(e.fieldVar));
  }
  onArrayNewExpr(e: ArrayNewExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return e.init === undefined
      ? this.sv.onArrayNewDefault(locOf(e), varIdx(e.typeVar))
      : this.sv.onArrayNew(locOf(e), varIdx(e.typeVar));
  }
  onArrayNewFixedExpr(e: ArrayNewFixedExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayNewFixed(locOf(e), varIdx(e.typeVar), e.operands.length);
  }
  onArrayNewDataExpr(e: ArrayNewDataExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayNewData(locOf(e), varIdx(e.typeVar), varIdx(e.dataVar));
  }
  onArrayNewElemExpr(e: ArrayNewElemExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayNewElem(locOf(e), varIdx(e.typeVar), varIdx(e.elemVar));
  }
  onArrayGetExpr(e: ArrayGetExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayGet(locOf(e), varIdx(e.typeVar), e.signed);
  }
  onArraySetExpr(e: ArraySetExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArraySet(locOf(e), varIdx(e.typeVar));
  }
  onArrayFillExpr(e: ArrayFillExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayFill(locOf(e), varIdx(e.typeVar));
  }
  onArrayCopyExpr(e: ArrayCopyExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayCopy(locOf(e), varIdx(e.destTypeVar), varIdx(e.srcTypeVar));
  }
  onArrayInitSegmentExpr(e: ArrayInitSegmentExpr): Result {
    return this.sv.onArrayInitSegment(
      locOf(e),
      varIdx(e.typeVar),
      e.kind === 'array.init_elem',
      varIdx(e.segment),
    );
  }
  onArrayLenExpr(e: ArrayLenExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onArrayLen(locOf(e));
  }
  onRefTestExpr(e: RefTestExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    // Hand over the type being tested FOR — `(ref [null] H)` — so the operand
    // can be checked against it, exactly as `onRefCastExpr` does below.
    return this.sv.onRefTest(locOf(e), {
      heapType: e.heapType,
      nullable: e.nullable,
    });
  }
  onRefCastExpr(e: RefCastExpr): Result {
    const rf = this.sv.requireFeature('gc', 'GC instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    // Hand over the type being cast TO — `(ref [null] H)` — so the result on
    // the stack is that type rather than an anonymous reference.
    return this.sv.onRefCast(locOf(e), {
      heapType: e.heapType,
      nullable: e.nullable,
    });
  }

  onTableGetExpr(e: TableGetExpr): Result {
    return this.sv.onTableGet(locOf(e), varIdx(e.table));
  }
  onTableSetExpr(e: TableSetExpr): Result {
    return this.sv.onTableSet(locOf(e), varIdx(e.table));
  }
  onTableGrowExpr(e: TableGrowExpr): Result {
    return this.sv.onTableGrow(locOf(e), varIdx(e.table));
  }
  onTableSizeExpr(e: TableSizeExpr): Result {
    return this.sv.onTableSize(locOf(e), varIdx(e.table));
  }
  onTableFillExpr(e: TableFillExpr): Result {
    return this.sv.onTableFill(locOf(e), varIdx(e.table));
  }
  onTableCopyExpr(e: TableCopyExpr): Result {
    return this.sv.onTableCopy(locOf(e), varIdx(e.destTable), varIdx(e.sourceTable));
  }
  onTableInitExpr(e: TableInitExpr): Result {
    return this.sv.onTableInit(locOf(e), varIdx(e.segment), varIdx(e.table));
  }
  onElemDropExpr(e: ElemDropExpr): Result {
    return this.sv.onElemDrop(locOf(e), varIdx(e.segment));
  }

  onThrowExpr(e: ThrowExpr): Result {
    const rf = this.sv.requireFeature('exceptions', 'exception handling', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onThrow(locOf(e), varIdx(e.tag));
  }
  onThrowRefExpr(e: ThrowRefExpr): Result {
    const rf = this.sv.requireFeature('exceptions', 'exception handling', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onThrowRef(locOf(e));
  }
  onRethrowExpr(e: RethrowExpr): Result {
    const rf = this.sv.requireFeature('exceptions', 'exception handling', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onRethrow(locOf(e), varIdx(e.target));
  }

  beginTryExpr(e: TryExpr): Result {
    const rf = this.sv.requireFeature('exceptions', 'exception handling', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return combineResults(this.checkCarrierHeader(e), this.sv.onTry(locOf(e), blockTypeOf(e)));
  }
  onCatchExpr(_e: TryExpr, c: Catch, _i: number): Result {
    const isCatchAll = c.tag === undefined;
    return this.sv.onCatch(locOf(c), c.tag ? varIdx(c.tag) : 0, isCatchAll);
  }
  onDelegateExpr(e: TryExpr): Result {
    return this.sv.onDelegate(locOf(e), e.delegate ? varIdx(e.delegate) : 0);
  }
  endTryExpr(e: TryExpr): Result {
    return this.sv.onEnd(locOf(e));
  }

  beginTryTableExpr(e: TryTableExpr): Result {
    const rf = this.sv.requireFeature('exceptions', 'exception handling', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    // Catches are checked BEFORE the try_table's own label is pushed: their
    // depths are relative to the ENCLOSING scope. Checking them after
    // `beginTryTable` reads every target one level too deep — the same
    // off-by-one T7.6 fixed on the parser side, and it showed up here as six
    // valid modules being rejected.
    let r: Result = Result.Ok;
    for (const c of e.catches) {
      r = combineResults(
        r,
        this.sv.onTryTableCatch(
          locOf(e),
          c.tag !== undefined ? varIdx(c.tag) : undefined,
          c.isRef,
          varIdx(c.target),
        ),
      );
    }
    r = combineResults(r, this.checkCarrierHeader(e));
    return combineResults(r, this.sv.beginTryTable(locOf(e), blockTypeOf(e)));
  }
  endTryTableExpr(e: TryTableExpr): Result {
    return this.sv.onEnd(locOf(e));
  }

  onSimdExtractExpr(e: SimdExtractExpr): Result {
    return this.sv.onSimdLaneOp(locOf(e), e.opcode, e.lane);
  }
  onSimdReplaceExpr(e: SimdReplaceExpr): Result {
    return this.sv.onSimdLaneOp(locOf(e), e.opcode, e.lane);
  }
  onSimdShuffleOpExpr(e: SimdShuffleOpExpr): Result {
    return this.sv.onSimdShuffleOp(locOf(e), OPCODE_I8X16_SHUFFLE, e.lanes);
  }
  /**
   * `load_lane` and `store_lane` share one node; their STACK EFFECTS differ — a
   * store consumes the vector and pushes nothing, a load consumes and pushes.
   *
   * ⚠️ The two writers' handlers for this pair were byte-for-byte identical,
   * because both only emit the opcode and the memarg. This one is not, and
   * merging the node without noticing that made `v128.store8_lane` fail type
   * checking. Identical handlers on one consumer say nothing about another.
   */
  onSimdLoadLaneExpr(e: SimdLoadLaneExpr): Result {
    return anyOpcodeName(e.opcode).includes('store')
      ? this.sv.onSimdStoreLane(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset, e.lane)
      : this.sv.onSimdLoadLane(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset, e.lane);
  }

  /** Same split for `load_splat` and `load_zero`, which also share a node. */
  onLoadSplatExpr(e: LoadSplatExpr): Result {
    return anyOpcodeName(e.opcode).includes('_zero')
      ? this.sv.onLoadZero(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset)
      : this.sv.onLoadSplat(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }

  onAtomicLoadExpr(e: AtomicLoadExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicLoad(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicStoreExpr(e: AtomicStoreExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicStore(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicRmwExpr(e: AtomicRmwExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicRmw(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicRmwCmpxchgExpr(e: AtomicRmwCmpxchgExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicRmwCmpxchg(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicWaitExpr(e: AtomicWaitExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicWait(locOf(e), e.opcode, varIdx(e.memidx), e.align, e.offset);
  }
  onAtomicNotifyExpr(e: AtomicNotifyExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    // memory.atomic.notify is a single fixed opcode: prefix 0xfe, secondary 0x00
    // `(0xfe << 8) | 0x00` was the pre-T7.7 packing; opcodes are `<< 16` now,
    // so this key matched nothing and memory.atomic.notify went unchecked.
    const ATOMIC_NOTIFY_OPCODE = (PREFIX_THREADS << 16) | 0x00;
    return this.sv.onAtomicNotify(
      locOf(e),
      ATOMIC_NOTIFY_OPCODE,
      varIdx(e.memidx),
      e.align,
      e.offset,
    );
  }
  onAtomicFenceExpr(e: AtomicFenceExpr): Result {
    const rf = this.sv.requireFeature('threads', 'atomic instruction', locOf(e));
    if (rf !== Result.Ok) this.acc(rf);
    return this.sv.onAtomicFence(locOf(e), e.consistencyModel);
  }

  onCodeMetadataExpr(_e: CodeMetadataExpr): Result {
    return Result.Ok;
  }
}
