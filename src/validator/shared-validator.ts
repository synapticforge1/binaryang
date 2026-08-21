// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/shared-validator.cc / include/wabt/shared-validator.h
// Copyright 2020 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import { combineResults, Result } from '../core/result.ts';
import { isReferenceType, Type } from '../core/types.ts';
import type { Index } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import { defaultFeatures } from '../core/feature.ts';
import type { Features } from '../core/feature.ts';
import { addError, unknownLocation } from '../core/error.ts';
import type { ErrorList, Location } from '../core/error.ts';
import { TypeChecker } from './type-checker.ts';
import { naturalAlignForOpcode } from '../core/opcode.ts';
import type { FuncType, HeapTypeInfo } from './type-checker.ts';
import type { BlockType, Field, Limits, SegmentKind, ValueType } from '../ir/ir.ts';
import { CatchKind, isRefValueType, varIndex } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

// Placeholder for future feature flags. Switched from `interface` to a type
// alias so the deno-lint `no-empty-interface` rule does not flag it.
export interface ValidateOptions {
  /**
   * Which proposals the module is allowed to use. Defaults to
   * {@link defaultFeatures}.
   *
   * This used to be `Record<string, never>` — the validator had no feature
   * awareness at all, and rules that MVP wasm imposed but later proposals
   * relaxed (at most one table, at most one memory) were unconditional. That
   * alone rejected 218 spec-testsuite modules V8 accepts.
   */
  features?: Features;
}

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface SVTableType {
  element: ValueType;
  limits: Limits;
}
interface SVMemoryType {
  limits: Limits;
}
interface SVGlobalType {
  type: ValueType;
  mutable: boolean;
}
interface SVTagType {
  params: ValueType[];
}
interface SVElemType {
  element: ValueType;
  isActive: boolean;
  tableType: ValueType;
}
interface SVLocalDecl {
  type: ValueType;
  end: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Promote a struct/array packed field type (i8/i16) to its stack representation (i32).
 * Other types pass through unchanged. The wasm GC spec stores packed fields in
 * compact memory but operates on i32 values on the stack — struct.new takes
 * i32 args for packed fields; struct.get_s/get_u return i32.
 */
function packedToStackType(tIn: ValueType): ValueType {
  const t = tIn;
  if (t === Type.I8 || t === Type.I16) return Type.I32;
  return t;
}

function isPowerOfTwo(x: number): boolean {
  return x > 0 && (x & (x - 1)) === 0;
}

// ---------------------------------------------------------------------------
// SharedValidator
// ---------------------------------------------------------------------------

export class SharedValidator {
  private tc: TypeChecker;
  private errors: ErrorList;
  private currentLoc: Location = unknownLocation();
  inInitExpr = false;

  // Type section registry (index → FuncType for func entries only)
  private funcTypesMap: Map<number, FuncType> = new Map();
  /**
   * Kind + declared supertypes of every type-section entry, for
   * defined-type subtyping. Shared with the TypeChecker by reference so
   * entries decoded later are visible to checks made later.
   */
  private heapTypesMap: Map<number, HeapTypeInfo> = new Map();
  // Struct type entries keyed by absolute type index — used by struct.* validators
  private structTypesMap: Map<number, Field[]> = new Map();
  // Array type entries keyed by absolute type index — used by array.* validators
  private arrayTypesMap: Map<number, Field> = new Map();
  private numTypes = 0; // total type entries (func + struct + array)

  // Module-level registries (imports + defined in declaration order)
  private funcs: FuncType[] = [];
  private tables: SVTableType[] = [];
  private memories: SVMemoryType[] = [];
  private globals: SVGlobalType[] = [];
  private tags: SVTagType[] = [];
  private elems: SVElemType[] = [];

  private numImportedGlobals = 0;
  private starts = 0;
  private dataSegmentCount = 0;

  // Per-function locals (rebuilt at BeginFunctionBody)
  private locals: SVLocalDecl[] = [];

  // Export duplicate tracking
  private exportNames: Set<string> = new Set();

  // ref.func declaration tracking
  private declaredFuncs: Set<number> = new Set();
  private checkDeclaredFuncs: number[] = [];

  private readonly features: Features;

  constructor(errors: ErrorList, options?: ValidateOptions) {
    this.errors = errors;
    this.features = options?.features ?? defaultFeatures();
    this.tc = new TypeChecker(this.funcTypesMap, this.heapTypesMap);
    this.tc.setErrorCallback((msg) => this.onTypecheckerError(msg));
  }

  // ---------------------------------------------------------------------------
  // Error reporting
  // ---------------------------------------------------------------------------

  private onTypecheckerError(msg: string): void {
    addError(this.errors, this.currentLoc, msg);
  }

  printError(loc: Location, msg: string): Result {
    addError(this.errors, loc, msg);
    return Result.Error;
  }

  setCurrentLoc(loc: Location): void {
    this.currentLoc = loc;
  }

  // ---------------------------------------------------------------------------
  // Index helpers
  // ---------------------------------------------------------------------------

  private checkIndex(idx: number, max: number, desc: string, loc: Location): Result {
    if (idx >= max) {
      return this.printError(loc, `${desc} variable out of range: ${idx} (max ${max})`);
    }
    return Result.Ok;
  }

  private checkFuncTypeIndex(idx: number, loc: Location): FuncType | null {
    if (idx >= this.numTypes) {
      this.printError(loc, `function type variable out of range: ${idx} (max ${this.numTypes})`);
      return null;
    }
    const ft = this.funcTypesMap.get(idx);
    if (!ft) {
      this.printError(loc, `type ${idx} is not a function`);
      return null;
    }
    return ft;
  }

  private checkFuncIndex(idx: number, loc: Location): FuncType | null {
    if (idx >= this.funcs.length) {
      this.printError(loc, `function variable out of range: ${idx} (max ${this.funcs.length})`);
      return null;
    }
    return this.funcs[idx] ?? null;
  }

  private checkTableIndex(idx: number, loc: Location): SVTableType | null {
    if (idx >= this.tables.length) {
      this.printError(loc, `table variable out of range: ${idx} (max ${this.tables.length})`);
      return null;
    }
    return this.tables[idx] ?? null;
  }

  private checkMemoryIndex(idx: number, loc: Location): SVMemoryType | null {
    if (idx >= this.memories.length) {
      this.printError(loc, `memory variable out of range: ${idx} (max ${this.memories.length})`);
      return null;
    }
    return this.memories[idx] ?? null;
  }

  private checkGlobalIndex(idx: number, loc: Location): SVGlobalType | null {
    if (idx >= this.globals.length) {
      this.printError(loc, `global variable out of range: ${idx} (max ${this.globals.length})`);
      return null;
    }
    return this.globals[idx] ?? null;
  }

  private checkTagIndex(idx: number, loc: Location): SVTagType | null {
    if (idx >= this.tags.length) {
      this.printError(loc, `tag variable out of range: ${idx} (max ${this.tags.length})`);
      return null;
    }
    return this.tags[idx] ?? null;
  }

  private checkElemSegmentIndex(idx: number, loc: Location): SVElemType | null {
    if (idx >= this.elems.length) {
      this.printError(loc, `elem_segment variable out of range: ${idx} (max ${this.elems.length})`);
      return null;
    }
    return this.elems[idx] ?? null;
  }

  private checkDataSegmentIndex(idx: number, loc: Location): Result {
    return this.checkIndex(idx, this.dataSegmentCount, 'data_segment', loc);
  }

  private checkLocalIndex(idx: number, loc: Location): ValueType | null {
    for (const decl of this.locals) {
      if (idx < decl.end) return decl.type;
    }
    const count = this.locals.length === 0 ? 0 : (this.locals[this.locals.length - 1]?.end ?? 0);
    this.printError(loc, `local variable out of range (max ${count})`);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Alignment checks
  // ---------------------------------------------------------------------------

  private checkAlign(loc: Location, align: number, naturalAlign: number): Result {
    if (!isPowerOfTwo(align)) {
      return this.printError(loc, `alignment (${align}) must be a power of 2`);
    }
    if (align > naturalAlign) {
      return this.printError(
        loc,
        `alignment must not be larger than natural alignment (${naturalAlign})`,
      );
    }
    return Result.Ok;
  }

  private checkAtomicAlign(loc: Location, align: number, naturalAlign: number): Result {
    if (!isPowerOfTwo(align)) {
      return this.printError(loc, `alignment (${align}) must be a power of 2`);
    }
    if (align !== naturalAlign) {
      return this.printError(loc, `alignment must be equal to natural alignment (${naturalAlign})`);
    }
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Block type resolution
  // ---------------------------------------------------------------------------

  private resolveBlockType(
    bt: BlockType,
    loc: Location,
  ): { params: ValueType[]; results: ValueType[] } {
    if (bt.kind === 'void') return { params: [], results: [] };
    if (bt.kind === 'value') return { params: [], results: [bt.type] };
    const ft = this.funcTypesMap.get(bt.typeIdx);
    if (!ft) {
      this.printError(loc, `type index ${bt.typeIdx} is not a function type`);
      return { params: [], results: [] };
    }
    return { params: [...ft.params], results: [...ft.results] };
  }

  // ---------------------------------------------------------------------------
  // Type section
  // ---------------------------------------------------------------------------

  /** The non-nullable reference to a defined type: `(ref $idx)`. */
  private refTo(idx: number): ValueType {
    return { kind: 'ref', heapType: varIndex(idx), nullable: false };
  }

  /** `(ref null $idx)` — what an operand slot accepts for a defined type. */
  private refNullTo(idx: number): ValueType {
    return { kind: 'ref', heapType: varIndex(idx), nullable: true };
  }

  /**
   * Every heap-type INDEX inside a value type must name a real type-section
   * entry.
   *
   * Nothing checked this: `(array (mut (ref null 10)))` in a module with one
   * type validated clean, because the index is only ever consulted when some
   * subtyping question happens to reach it — and `heapSatisfies` treats an
   * unknown index as "accept" so it does not emit a second error for a cause
   * reported elsewhere. That deferral only works if the cause IS reported
   * somewhere, which is here.
   */
  /** Report an instruction that is not allowed in a constant expression. */
  onNonConstExpr(loc: Location, kind: string): Result {
    return this.printError(loc, `constant expression required: ${kind} is not constant`);
  }

  /**
   * Is `a` acceptable where `b` is wanted? Exposes the TypeChecker's lattice
   * so module-level checks (declared `(sub …)` validity) can use the same
   * rules the instruction checks do.
   */
  isSubtype(a: ValueType, b: ValueType): boolean {
    return this.tc.checkType(a, b) === Result.Ok;
  }

  /** Report a `(sub …)` declaration whose definition does not fit. */
  onBadSubtype(loc: Location, idx: number, superIdx: number, why: string): Result {
    return this.printError(loc, `sub type ${idx} does not match supertype ${superIdx}: ${why}`);
  }

  /** Report a type that declares a FINAL type as its supertype. */
  onFinalSupertype(loc: Location, idx: number, superIdx: number): Result {
    return this.printError(loc, `sub type ${idx} extends final type ${superIdx}`);
  }

  /** Report a supertype index that names no type. */
  onUnknownType(loc: Location, idx: number): Result {
    return this.printError(loc, `unknown type ${idx}`);
  }

  checkValueType(loc: Location, vt: ValueType, what: string, bound = this.numTypes): Result {
    if (!isRefValueType(vt)) return Result.Ok;
    const h = vt.heapType;
    if (h.kind !== 'index') return Result.Ok;
    // `bound` is the SCOPE, not the section size: a type may reference
    // anything defined before it plus the rest of its own rec group, and
    // nothing later. Checking against the section size instead accepted
    // `(type (func (result (ref 1)))) (type (func))`, a forward reference
    // across groups that the spec and V8 both reject.
    if (h.value >= bound) {
      return this.printError(loc, `unknown type ${h.value} in ${what}`);
    }
    return Result.Ok;
  }

  onFuncType(
    _loc: Location,
    params: ValueType[],
    results: ValueType[],
    typeIndex: Index,
    supers: number[] = [],
    canon = '',
  ): Result {
    this.funcTypesMap.set(this.numTypes, { params, results, typeIndex });
    this.heapTypesMap.set(this.numTypes, { kind: 'func', supers, canon });
    this.numTypes++;
    return Result.Ok;
  }

  onStructType(
    _loc: Location,
    fields: Field[] = [],
    supers: number[] = [],
    canon = '',
  ): Result {
    this.structTypesMap.set(this.numTypes, fields);
    this.heapTypesMap.set(this.numTypes, { kind: 'struct', supers, canon });
    this.numTypes++;
    return Result.Ok;
  }

  onArrayType(
    _loc: Location,
    element?: Field,
    supers: number[] = [],
    canon = '',
  ): Result {
    if (element) this.arrayTypesMap.set(this.numTypes, element);
    this.heapTypesMap.set(this.numTypes, { kind: 'array', supers, canon });
    this.numTypes++;
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Module structure
  // ---------------------------------------------------------------------------

  onFunction(loc: Location, sigIdx: number): Result {
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    this.funcs.push(ft ?? { params: [], results: [], typeIndex: 0 });
    return ft ? Result.Ok : Result.Error;
  }

  /**
   * The index type of a memory / table — `i64` under memory64 / table64,
   * `i32` otherwise. An out-of-range index falls back to `i32`; the missing
   * item is reported separately, and guessing `i64` there would produce a
   * second, misleading error.
   */
  memoryIndexType(memIdx: Index): Type {
    return this.memories[memIdx]?.limits.is64 ? Type.I64 : Type.I32;
  }

  tableIndexType(tableIdx: Index): Type {
    return this.tables[tableIdx]?.limits.is64 ? Type.I64 : Type.I32;
  }

  /**
   * Can a slot of this type be created without an explicit value? Only
   * NULLABLE references and the numeric types have a default. A
   * `(ref $t)` does not, which is why `(table 0 (ref func))` needs an
   * initializer and `(local (ref $t))` needs a `local.set` before any read.
   */
  static isDefaultable(t: ValueType): boolean {
    if (isRefValueType(t)) return t.nullable;
    return !isReferenceType(t) || t !== Type.Ref;
  }

  onTable(loc: Location, elemTypeIn: ValueType, limits: Limits, hasInit = true): Result {
    const elemType = elemTypeIn;
    let r: Result = Result.Ok;
    // MVP allowed one table; the reference-types proposal lifted that.
    if (this.tables.length > 0 && !this.features.referenceTypes) {
      r = combineResults(r, this.printError(loc, 'only one table allowed'));
    }
    r = combineResults(r, this.checkLimits(loc, limits, 0xFFFFFFFF, 'elems'));
    if (!hasInit && !SharedValidator.isDefaultable(elemType)) {
      r = combineResults(
        r,
        this.printError(loc, 'type mismatch: a non-defaultable table needs an initial value'),
      );
    }
    this.tables.push({ element: elemType, limits });
    return r;
  }

  onMemory(loc: Location, limits: Limits): Result {
    let r: Result = Result.Ok;
    // MVP allowed one memory; the multi-memory proposal lifted that.
    if (this.memories.length > 0 && !this.features.multiMemory) {
      r = combineResults(r, this.printError(loc, 'only one memory block allowed'));
    }
    // The page LIMIT, not the representable range: a 32-bit memory tops out
    // at 65536 pages (4 GiB) and memory64 at 2^48. Using the full integer
    // range here accepted `(memory 65537)`, which the spec and every engine
    // reject.
    const absMax = limits.is64 ? (1n << 48n) : 65536n;
    r = combineResults(r, this.checkLimits64(loc, limits, absMax, 'pages'));
    if (limits.isShared && !limits.max) {
      r = combineResults(r, this.printError(loc, 'shared memories must have max sizes'));
    }
    this.memories.push({ limits });
    return r;
  }

  onGlobalImport(_loc: Location, typeIn: ValueType, mutable: boolean): Result {
    const type = typeIn;
    this.globals.push({ type, mutable });
    this.numImportedGlobals++;
    return Result.Ok;
  }

  onGlobal(_loc: Location, typeIn: ValueType, mutable: boolean): Result {
    const type = typeIn;
    this.globals.push({ type, mutable });
    return Result.Ok;
  }

  onTag(loc: Location, sigIdx: number): Result {
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    if (!ft) {
      this.tags.push({ params: [] });
      return Result.Error;
    }
    this.tags.push({ params: ft.params });
    if (ft.results.length > 0) {
      // `printError` returns Result.Error; propagate it instead of dropping it
      // and returning Ok (the error reached the ErrorList, but the Result chain
      // wrongly reported success for this node).
      return this.printError(loc, 'Tag signature must have 0 results.');
    }
    return Result.Ok;
  }

  onExport(loc: Location, kind: ExternalKind, itemIdx: number, name: string): Result {
    let r: Result = Result.Ok;
    if (this.exportNames.has(name)) {
      r = combineResults(r, this.printError(loc, `duplicate export "${name}"`));
    }
    this.exportNames.add(name);

    switch (kind) {
      case ExternalKind.Func: {
        const fr = this.checkIndex(itemIdx, this.funcs.length, 'function', loc);
        r = combineResults(r, fr);
        if (fr === Result.Ok) this.declaredFuncs.add(itemIdx);
        break;
      }
      case ExternalKind.Table:
        r = combineResults(r, this.checkIndex(itemIdx, this.tables.length, 'table', loc));
        break;
      case ExternalKind.Memory:
        r = combineResults(r, this.checkIndex(itemIdx, this.memories.length, 'memory', loc));
        break;
      case ExternalKind.Global:
        r = combineResults(r, this.checkIndex(itemIdx, this.globals.length, 'global', loc));
        break;
      case ExternalKind.Tag:
        r = combineResults(r, this.checkIndex(itemIdx, this.tags.length, 'tag', loc));
        break;
    }
    return r;
  }

  onStart(loc: Location, funcIdx: number): Result {
    let r: Result = Result.Ok;
    if (this.starts++ > 0) {
      r = combineResults(r, this.printError(loc, 'only one start function allowed'));
    }
    const ft = this.checkFuncIndex(funcIdx, loc);
    if (!ft) return Result.Error;
    if (ft.params.length !== 0) {
      r = combineResults(r, this.printError(loc, 'start function must be nullary'));
    }
    if (ft.results.length !== 0) {
      r = combineResults(r, this.printError(loc, 'start function must not return anything'));
    }
    return r;
  }

  onElemSegment(loc: Location, tableIdx: number, kind: SegmentKind): Result {
    let r: Result = Result.Ok;
    let tableType: ValueType = Type.FuncRef;
    if (kind === 'active') {
      const tt = this.checkTableIndex(tableIdx, loc);
      r = combineResults(r, tt ? Result.Ok : Result.Error);
      if (tt) tableType = tt.element;
    }
    this.elems.push({ element: Type.Void, isActive: kind === 'active', tableType });
    return r;
  }

  onElemSegmentElemType(_loc: Location, elemTypeIn: ValueType): Result {
    const elemType = elemTypeIn;
    const elem = this.elems[this.elems.length - 1];
    if (elem) elem.element = elemType;
    return Result.Ok;
  }

  onDataCount(count: number): void {
    this.dataSegmentCount = count;
  }

  onDataSegment(loc: Location, memoryIdx: number, kind: SegmentKind): Result {
    if (kind === 'active') {
      return this.checkIndex(memoryIdx, this.memories.length, 'memory', loc);
    }
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Init expressions
  // ---------------------------------------------------------------------------

  beginInitExpr(loc: Location, typeIn: ValueType): Result {
    const type = typeIn;
    this.currentLoc = loc;
    this.inInitExpr = true;
    return this.tc.beginInitExpr(type);
  }

  endInitExpr(): Result {
    this.inInitExpr = false;
    return this.tc.endInitExpr();
  }

  // ---------------------------------------------------------------------------
  // Function bodies
  // ---------------------------------------------------------------------------

  beginFunctionBody(loc: Location, funcIdx: number): Result {
    this.currentLoc = loc;
    this.locals = [];
    const ft = this.funcs[funcIdx];
    if (ft) {
      let end = 0;
      for (const p of ft.params) {
        end++;
        this.locals.push({ type: p, end });
      }
      return this.tc.beginFunction(ft.params, ft.results);
    }
    return this.tc.beginFunction([], []);
  }

  endFunctionBody(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.endFunction();
  }

  onLocalDecl(_loc: Location, count: number, typeIn: ValueType): Result {
    const type = typeIn;
    const cur = this.locals.length === 0 ? 0 : (this.locals[this.locals.length - 1]?.end ?? 0);
    this.locals.push({ type, end: cur + count });
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — control flow
  // ---------------------------------------------------------------------------

  onUnreachable(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onUnreachable();
  }

  onNop(loc: Location): Result {
    this.currentLoc = loc;
    return Result.Ok;
  }

  onBlock(loc: Location, blockType: BlockType): Result {
    this.currentLoc = loc;
    const { params, results } = this.resolveBlockType(blockType, loc);
    return this.tc.onBlock(params, results);
  }

  onLoop(loc: Location, blockType: BlockType): Result {
    this.currentLoc = loc;
    const { params, results } = this.resolveBlockType(blockType, loc);
    return this.tc.onLoop(params, results);
  }

  onIf(loc: Location, blockType: BlockType): Result {
    this.currentLoc = loc;
    const { params, results } = this.resolveBlockType(blockType, loc);
    return this.tc.onIf(params, results);
  }

  onElse(_loc: Location): Result {
    return this.tc.onElse();
  }

  onEnd(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onEnd();
  }

  onBr(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onBr(depth);
  }

  onBrIf(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onBrIf(depth);
  }

  beginBrTable(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.beginBrTable();
  }

  onBrTableTarget(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onBrTableTarget(depth);
  }

  endBrTable(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.endBrTable();
  }

  onBrOnNull(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onBrOnNull(depth);
  }

  onBrOnNonNull(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onBrOnNonNull(depth);
  }

  onBrOnCast(
    loc: Location,
    depth: number,
    onFail: boolean,
    from: ValueType,
    to: ValueType,
  ): Result {
    this.currentLoc = loc;
    // br_on_cast branches with rt2 and falls through with `rt1 \ rt2`; the
    // `_fail` spelling is the other way round.
    //
    // The DIFFERENCE is not just rt1. If rt2 is nullable it absorbs the null
    // case, so the difference is non-nullable — which is why
    // `br_on_cast_fail $l (ref null any) (ref null struct)` targets a label
    // typed `(ref any)`, and passing rt1 through unchanged rejected it.
    const diff: ValueType = isRefValueType(from)
      ? { ...from, nullable: from.nullable && !(isRefValueType(to) ? to.nullable : true) }
      : from;
    return this.tc.onBrOnCast(
      depth,
      onFail ? 'br_on_cast_fail' : 'br_on_cast',
      onFail ? diff : to,
      onFail ? to : diff,
    );
  }

  onReturn(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onReturn();
  }

  onDrop(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onDrop();
  }

  onSelect(loc: Location, resultTypesIn: ValueType[]): Result {
    const resultTypes = resultTypesIn;
    this.currentLoc = loc;
    if (resultTypes.length > 1) {
      return this.printError(loc, `invalid arity in select instruction: ${resultTypes.length}.`);
    }
    return this.tc.onSelect(resultTypes);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — locals / globals
  // ---------------------------------------------------------------------------

  onLocalGet(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    return this.tc.onLocalGet(type);
  }

  onLocalSet(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    return this.tc.onLocalSet(type);
  }

  onLocalTee(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    return this.tc.onLocalTee(type);
  }

  onGlobalGet(loc: Location, globalIdx: number): Result {
    this.currentLoc = loc;
    const gt = this.checkGlobalIndex(globalIdx, loc);
    if (!gt) return Result.Error;
    let r = this.tc.onGlobalGet(gt.type);
    if (this.inInitExpr) {
      // MVP restricted a constant expression to imported globals. The
      // extended-const and GC proposals both relax it to any DEFINED global
      // declared earlier, which the spec testsuite relies on.
      const relaxed = this.features.extendedConst || this.features.gc;
      if (globalIdx >= this.numImportedGlobals && !relaxed) {
        r = combineResults(
          r,
          this.printError(loc, 'initializer expression can only reference an imported global'),
        );
      }
      if (gt.mutable) {
        r = combineResults(
          r,
          this.printError(loc, 'initializer expression cannot reference a mutable global'),
        );
      }
    }
    return r;
  }

  onGlobalSet(loc: Location, globalIdx: number): Result {
    this.currentLoc = loc;
    const gt = this.checkGlobalIndex(globalIdx, loc);
    if (!gt) return Result.Error;
    if (!gt.mutable) {
      return combineResults(
        this.printError(loc, `can't global.set on immutable global at index ${globalIdx}.`),
        this.tc.onGlobalSet(gt.type),
      );
    }
    return this.tc.onGlobalSet(gt.type);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — constants
  // ---------------------------------------------------------------------------

  onConst(loc: Location, type: Type): Result {
    this.currentLoc = loc;
    return this.tc.onConst(type);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — arithmetic / comparison / conversion
  // ---------------------------------------------------------------------------

  onBinary(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onBinary(opcode);
  }

  onUnary(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onUnary(opcode);
  }

  onCompare(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onCompare(opcode);
  }

  onConvert(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onConvert(opcode);
  }

  onTernary(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onTernary(opcode);
  }

  onQuaternary(loc: Location, opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onQuaternary(opcode);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — memory
  // ---------------------------------------------------------------------------

  /**
   * A memarg `offset=N` must fit the memory's INDEX TYPE — u32 for a 32-bit
   * memory, u64 for memory64.
   *
   * This went unchecked because the reader used to read the field as u32 and
   * threw on anything larger; once T9.2 widened it to u64 so memory64 could
   * work, an out-of-range 32-bit offset decoded cleanly and validated.
   */
  private checkMemArgOffset(loc: Location, offset: bigint, is64: boolean): Result {
    const max = is64 ? (1n << 64n) - 1n : 0xFFFFFFFFn;
    if (offset > max) {
      return this.printError(
        loc,
        `offset out of range: ${offset} exceeds the memory index type`,
      );
    }
    return Result.Ok;
  }

  onLoad(loc: Location, opcode: number, memIdx: number, align: number, offset: bigint): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false));
    r = combineResults(r, this.tc.onLoad(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onStore(loc: Location, opcode: number, memIdx: number, align: number, offset: bigint): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false));
    r = combineResults(r, this.tc.onStore(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onLoadSplat(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onLoadSplat(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onLoadZero(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onLoadZero(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onMemorySize(loc: Location, memIdx: number): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    if (!mt) return Result.Error;
    return this.tc.onMemorySize(mt.limits.is64);
  }

  onMemoryGrow(loc: Location, memIdx: number): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    if (!mt) return Result.Error;
    return this.tc.onMemoryGrow(mt.limits.is64);
  }

  onMemoryCopy(loc: Location, dstMemIdx: number, srcMemIdx: number): Result {
    this.currentLoc = loc;
    const dmt = this.checkMemoryIndex(dstMemIdx, loc);
    const smt = this.checkMemoryIndex(srcMemIdx, loc);
    let r = (dmt && smt) ? Result.Ok : Result.Error;
    r = combineResults(
      r,
      this.tc.onMemoryCopy(dmt?.limits.is64 ?? false, smt?.limits.is64 ?? false),
    );
    return r;
  }

  onMemoryFill(loc: Location, memIdx: number): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    if (!mt) return Result.Error;
    return this.tc.onMemoryFill(mt.limits.is64);
  }

  onMemoryInit(loc: Location, segIdx: number, memIdx: number): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    r = combineResults(r, this.checkDataSegmentIndex(segIdx, loc));
    r = combineResults(r, this.tc.onMemoryInit(mt?.limits.is64 ?? false));
    return r;
  }

  onDataDrop(loc: Location, segIdx: number): Result {
    this.currentLoc = loc;
    let r = this.checkDataSegmentIndex(segIdx, loc);
    r = combineResults(r, this.tc.onDataDrop());
    return r;
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — atomics
  // ---------------------------------------------------------------------------

  onAtomicFence(loc: Location, consistencyModel: number): Result {
    this.currentLoc = loc;
    let r: Result = Result.Ok;
    if (consistencyModel !== 0) {
      // Propagate the error into the Result (same fix as onTag) rather than
      // recording it but returning Ok.
      r = this.printError(
        loc,
        `unexpected atomic.fence consistency model (expected 0): ${consistencyModel}`,
      );
    }
    return combineResults(r, this.tc.onAtomicFence());
  }

  onAtomicLoad(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicLoad(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicStore(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicStore(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicRmw(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicRmw(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicRmwCmpxchg(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicRmwCmpxchg(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicWait(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicWait(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicNotify(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicNotify(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — calls
  // ---------------------------------------------------------------------------

  onCall(loc: Location, funcIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncIndex(funcIdx, loc);
    if (!ft) return Result.Error;
    return this.tc.onCall(ft.params, ft.results);
  }

  onCallIndirect(loc: Location, sigIdx: number, tableIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    const tt = this.checkTableIndex(tableIdx, loc);
    let r = (ft && tt) ? Result.Ok : Result.Error;
    // The table must hold FUNCTION references — but `(ref null $t)` for a
    // func type is one, and it coarsens to StructRef here, so an exact
    // FuncRef comparison rejected it. Reference-ness is all this lattice can
    // check; see TypeChecker.checkType.
    // A `(ref $T)` element type is a reference too, so ask isRefValueType
    // first — before T9.3 it could not be one, because coarsening had already
    // flattened it to an abstract Type.
    if (tt && !isRefValueType(tt.element) && !isReferenceType(tt.element)) {
      r = combineResults(
        r,
        this.printError(loc, 'type mismatch: call_indirect must reference table of funcref type'),
      );
    }
    if (ft) {
      // A 64-bit table is indexed by i64.
      r = combineResults(
        r,
        this.tc.onCallIndirect(ft.params, ft.results, tt?.limits.is64 ?? false),
      );
    }
    return r;
  }

  onCallRef(loc: Location, sigIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    if (!ft) return Result.Error;
    return this.tc.onCallRef(Type.FuncRef, ft.params, ft.results);
  }

  onReturnCall(loc: Location, funcIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncIndex(funcIdx, loc);
    if (!ft) return Result.Error;
    return this.tc.onReturnCall(ft.params, ft.results);
  }

  onReturnCallIndirect(loc: Location, sigIdx: number, tableIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    const tt = this.checkTableIndex(tableIdx, loc);
    let r = (ft && tt) ? Result.Ok : Result.Error;
    if (ft) {
      r = combineResults(r, this.tc.onReturnCallIndirect(ft.params, ft.results, false));
    }
    return r;
  }

  onReturnCallRef(loc: Location, sigIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    if (!ft) return Result.Error;
    return this.tc.onReturnCallRef(Type.FuncRef, ft.params, ft.results);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — ref types
  // ---------------------------------------------------------------------------

  onRefNull(loc: Location, refType: ValueType): Result {
    this.currentLoc = loc;
    return this.tc.onRefNull(refType);
  }

  onRefIsNull(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onRefIsNull();
  }

  onRefFunc(loc: Location, funcIdx: number): Result {
    this.currentLoc = loc;
    let r = this.checkIndex(funcIdx, this.funcs.length, 'function', loc);
    if (r === Result.Ok) {
      if (this.inInitExpr) {
        this.declaredFuncs.add(funcIdx);
      } else {
        this.checkDeclaredFuncs.push(funcIdx);
      }
    }
    r = combineResults(r, this.tc.onRefFunc(this.funcs[funcIdx]?.typeIndex ?? 0));
    return r;
  }

  onRefAsNonNull(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onRefAsNonNull();
  }

  onRefEq(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onRefEq();
  }

  onRefI31(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onRefI31();
  }

  /**
   * `any.convert_extern` : [externref] -> [anyref]
   * `extern.convert_any` : [anyref]    -> [externref]
   */
  onExternConvert(loc: Location, toAny: boolean): Result {
    this.currentLoc = loc;
    return toAny
      ? this.tc.onCall([Type.ExternRef], [Type.AnyRef])
      : this.tc.onCall([Type.AnyRef], [Type.ExternRef]);
  }

  onI31Get(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onI31Get();
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — GC struct
  // ---------------------------------------------------------------------------

  /** Look up a struct type entry by index; returns null + records an error if missing or wrong kind. */
  private checkStructTypeIndex(typeIdx: number, loc: Location): { fields: Field[] } | null {
    const fields = this.structTypesMap.get(typeIdx);
    if (fields === undefined) {
      this.printError(loc, `type index ${typeIdx} is not a struct (out of range or wrong kind)`);
      return null;
    }
    return { fields };
  }

  onStructNew(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    // struct.new pops one value per field (in field order), pushes (ref $type).
    // Packed fields (i8/i16) are written as i32 on the stack.
    const stackParams = st.fields.map((f) => packedToStackType(f.type));
    return this.tc.onCall(stackParams, [this.refTo(typeIdx)]);
  }

  onStructNewDefault(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    return this.tc.onCall([], [this.refTo(typeIdx)]);
  }

  onStructGet(loc: Location, typeIdx: number, fieldIdx: number, _signed?: boolean): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    const field = st.fields[fieldIdx];
    if (field === undefined) {
      this.printError(loc, `field index ${fieldIdx} out of range for struct type ${typeIdx}`);
      return Result.Error;
    }
    return this.tc.onCall([this.refNullTo(typeIdx)], [packedToStackType(field.type)]);
  }

  /** Reject a write to an immutable struct field or array element. */
  private checkMutable(loc: Location, mutable: boolean, what: string): Result {
    return mutable ? Result.Ok : this.printError(loc, `${what} is immutable`);
  }

  onStructSet(loc: Location, typeIdx: number, fieldIdx: number): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    const field = st.fields[fieldIdx];
    if (field === undefined) {
      this.printError(loc, `field index ${fieldIdx} out of range for struct type ${typeIdx}`);
      return Result.Error;
    }
    return combineResults(
      this.checkMutable(loc, field.mutable, `field ${fieldIdx} of type ${typeIdx}`),
      this.tc.onCall([this.refNullTo(typeIdx), packedToStackType(field.type)], []),
    );
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — GC array
  // ---------------------------------------------------------------------------

  /** Look up an array type entry by index; null + records an error if wrong kind. */
  private checkArrayTypeIndex(typeIdx: number, loc: Location): { element: Field } | null {
    const element = this.arrayTypesMap.get(typeIdx);
    if (element === undefined) {
      this.printError(loc, `type index ${typeIdx} is not an array (out of range or wrong kind)`);
      return null;
    }
    return { element };
  }

  onArrayNew(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // array.new pops [init, length(i32)], pushes (ref $T).
    return this.tc.onCall(
      [packedToStackType(at.element.type), Type.I32],
      [this.refTo(typeIdx)],
    );
  }

  onArrayNewDefault(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return this.tc.onCall([Type.I32], [this.refTo(typeIdx)]);
  }

  onArrayNewFixed(loc: Location, typeIdx: number, count: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const elem = packedToStackType(at.element.type);
    const params: ValueType[] = [];
    for (let i = 0; i < count; i++) params.push(elem);
    return this.tc.onCall(params, [this.refTo(typeIdx)]);
  }

  onArrayNewData(loc: Location, typeIdx: number, dataIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const dataCheck = this.checkDataSegmentIndex(dataIdx, loc);
    if (dataCheck !== Result.Ok) return dataCheck;
    return this.tc.onCall([Type.I32, Type.I32], [this.refTo(typeIdx)]);
  }

  onArrayNewElem(loc: Location, typeIdx: number, elemIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const elemCheck = this.checkElemSegmentIndex(elemIdx, loc);
    if (!elemCheck) return Result.Error;
    return this.tc.onCall([Type.I32, Type.I32], [this.refTo(typeIdx)]);
  }

  onArrayGet(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return this.tc.onCall(
      [this.refNullTo(typeIdx), Type.I32],
      [packedToStackType(at.element.type)],
    );
  }

  onArraySet(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return combineResults(
      this.checkMutable(loc, at.element.mutable, `element of array type ${typeIdx}`),
      this.tc.onCall(
        [this.refNullTo(typeIdx), Type.I32, packedToStackType(at.element.type)],
        [],
      ),
    );
  }

  onArrayFill(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // [ref, offset, value, size] -> []
    return combineResults(
      this.checkMutable(loc, at.element.mutable, `element of array type ${typeIdx}`),
      this.tc.onCall(
        [this.refNullTo(typeIdx), Type.I32, packedToStackType(at.element.type), Type.I32],
        [],
      ),
    );
  }

  onArrayCopy(loc: Location, destTypeIdx: number, srcTypeIdx: number): Result {
    this.currentLoc = loc;
    const dest = this.checkArrayTypeIndex(destTypeIdx, loc);
    const src = this.checkArrayTypeIndex(srcTypeIdx, loc);
    if (!dest || !src) return Result.Error;
    // [destRef, destOffset, srcRef, srcOffset, size] -> []
    // The source element must be assignable to the destination's — copying
    // an i16 array into an i8 array is not a type error the operand stack can
    // see, because both are just `(ref $t)` there.
    let r: Result = this.checkMutable(
      loc,
      dest.element.mutable,
      `element of array type ${destTypeIdx}`,
    );
    if (!this.isSubtype(src.element.type, dest.element.type)) {
      r = combineResults(
        r,
        this.printError(
          loc,
          `array types do not match: element of type ${srcTypeIdx} is not a subtype of type ${destTypeIdx}`,
        ),
      );
    }
    return combineResults(
      r,
      this.tc.onCall(
        [this.refNullTo(destTypeIdx), Type.I32, this.refNullTo(srcTypeIdx), Type.I32, Type.I32],
        [],
      ),
    );
  }

  onArrayInitSegment(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // [ref, destOffset, srcOffset, size] -> []
    return combineResults(
      this.checkMutable(loc, at.element.mutable, `element of array type ${typeIdx}`),
      this.tc.onCall([this.refNullTo(typeIdx), Type.I32, Type.I32, Type.I32], []),
    );
  }

  onArrayLen(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onArrayLen();
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — GC ref.test / ref.cast
  // ---------------------------------------------------------------------------

  onRefTest(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onRefTest();
  }

  /**
   * `ref.cast (ref [null] H) v` — the result is the CAST-TO type, not a
   * shrug. Reporting a coarse reference here was the whole reason a cast
   * feeding a typed slot failed to validate.
   */
  onRefCast(loc: Location, castTo: ValueType): Result {
    this.currentLoc = loc;
    return this.tc.onRefCast(castTo);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — tables
  // ---------------------------------------------------------------------------

  onTableGet(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableGet(tt.element, tt.limits.is64 ?? false);
  }

  onTableSet(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableSet(tt.element, tt.limits.is64 ?? false);
  }

  onTableGrow(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableGrow(tt.element, tt.limits.is64 ?? false);
  }

  onTableSize(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableSize(tt.limits.is64 ?? false);
  }

  onTableFill(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableFill(tt.element, tt.limits.is64 ?? false);
  }

  onTableCopy(loc: Location, dstIdx: number, srcIdx: number): Result {
    this.currentLoc = loc;
    const dtt = this.checkTableIndex(dstIdx, loc);
    const stt = this.checkTableIndex(srcIdx, loc);
    if (!dtt || !stt) return Result.Error;
    return this.tc.onTableCopy(dtt.limits.is64 ?? false, stt.limits.is64 ?? false);
  }

  onTableInit(loc: Location, segIdx: number, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    const et = this.checkElemSegmentIndex(segIdx, loc);
    let r = (tt && et) ? Result.Ok : Result.Error;
    r = combineResults(r, this.tc.onTableInit(tt?.limits.is64 ?? false));
    return r;
  }

  onElemDrop(loc: Location, segIdx: number): Result {
    this.currentLoc = loc;
    let r = this.checkElemSegmentIndex(segIdx, loc) ? Result.Ok : Result.Error;
    r = combineResults(r, this.tc.onElemDrop());
    return r;
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — exceptions
  // ---------------------------------------------------------------------------

  onThrow(loc: Location, tagIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTagIndex(tagIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onThrow(tt.params);
  }

  onThrowRef(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onThrowRef();
  }

  onRethrow(loc: Location, _depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onRethrow();
  }

  onTry(loc: Location, blockType: BlockType): Result {
    this.currentLoc = loc;
    const { params, results } = this.resolveBlockType(blockType, loc);
    return this.tc.onTry(params, results);
  }

  onCatch(loc: Location, tagIdx: number, isCatchAll: boolean): Result {
    this.currentLoc = loc;
    if (isCatchAll) return this.tc.onCatch([]);
    const tt = this.checkTagIndex(tagIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onCatch(tt.params);
  }

  onDelegate(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onDelegate(depth);
  }

  beginTryTable(loc: Location, blockType: BlockType): Result {
    this.currentLoc = loc;
    const { params, results } = this.resolveBlockType(blockType, loc);
    return this.tc.onBlock(params, results);
  }

  // The try_table label is closed via onEnd (the validator's endTryTableExpr
  // calls onEnd directly); there is no separate endTryTable handler.

  /**
   * Bounds-check one `try_table` catch clause's tag immediate. The catch's
   * branch-target label is a numeric depth already validated structurally by
   * the binary reader / parser; the precise branch-type reconciliation against
   * the labeled block type is a known remaining gap (the flat operand model
   * doesn't carry the tag's param types into the target check).
   */
  onTryTableCatch(loc: Location, kind: CatchKind, tag: number | undefined): Result {
    this.currentLoc = loc;
    if (
      (kind === CatchKind.Catch || kind === CatchKind.CatchRef) && tag !== undefined
    ) {
      return this.checkTagIndex(tag, loc) ? Result.Ok : Result.Error;
    }
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — SIMD
  // ---------------------------------------------------------------------------

  onSimdLaneOp(loc: Location, opcode: number, lane: number): Result {
    this.currentLoc = loc;
    return this.tc.onSimdLaneOp(opcode, lane);
  }

  onSimdLoadLane(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
    lane: number,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.checkLaneIndex(loc, lane, this.simdLaneCount(opcode)));
    r = combineResults(r, this.tc.onSimdLoadLane(mt?.limits.is64 ?? false));
    return r;
  }

  onSimdStoreLane(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    offset: bigint,
    lane: number,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    // The canonical per-opcode table in `core/opcode.ts`, not the
    // validator's own partial copy — that one had no SIMD memory entries,
    // so it returned 0 and the alignment check was skipped entirely for
    // every `v128.load*_splat` / `*_lane` / `*_zero`.
    const natAlign = naturalAlignForOpcode(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.checkLaneIndex(loc, lane, this.simdLaneCount(opcode)));
    r = combineResults(r, this.tc.onSimdStoreLane(mt?.limits.is64 ?? false));
    return r;
  }

  /**
   * `i8x16.shuffle` — every mask byte selects a lane from the two 16-byte
   * operands concatenated, so it must be < 32. The mask was not checked at
   * all; `i8x16.shuffle … 255` validated clean.
   */
  onSimdShuffleOp(loc: Location, _opcode: number, lanes?: Uint8Array): Result {
    this.currentLoc = loc;
    let r: Result = Result.Ok;
    if (lanes !== undefined) {
      for (const lane of lanes) {
        if (lane >= 32) {
          r = combineResults(r, this.printError(loc, `invalid lane index ${lane} (max 31)`));
          break;
        }
      }
    }
    return combineResults(r, this.tc.onSimdShuffleOp());
  }

  /**
   * Lane count for a `v128.load*_lane` / `store*_lane` sub-opcode: 16 lanes
   * for the 8-bit form down to 2 for the 64-bit one.
   */
  private simdLaneCount(opcode: number): number {
    switch (opcode & 0xffff) {
      case 0x54:
      case 0x58:
        return 16;
      case 0x55:
      case 0x59:
        return 8;
      case 0x56:
      case 0x5a:
        return 4;
      default:
        return 2;
    }
  }

  private checkLaneIndex(loc: Location, lane: number, count: number): Result {
    if (lane >= count) {
      return this.printError(loc, `invalid lane index ${lane} (max ${count - 1})`);
    }
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // End of module
  // ---------------------------------------------------------------------------

  endModule(): Result {
    let r: Result = Result.Ok;
    for (const funcIdx of this.checkDeclaredFuncs) {
      if (!this.declaredFuncs.has(funcIdx)) {
        r = combineResults(
          r,
          this.printError(
            unknownLocation(),
            `function ${funcIdx} is not declared in any elem sections`,
          ),
        );
      }
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Private: limit checks
  // ---------------------------------------------------------------------------

  private checkLimits(loc: Location, limits: Limits, absoluteMax: number, desc: string): Result {
    let r: Result = Result.Ok;
    if (limits.initial > absoluteMax) {
      r = combineResults(
        r,
        this.printError(loc, `initial ${desc} (${limits.initial}) must be <= (${absoluteMax})`),
      );
    }
    if (limits.max !== undefined) {
      if (limits.max > absoluteMax) {
        r = combineResults(
          r,
          this.printError(loc, `max ${desc} (${limits.max}) must be <= (${absoluteMax})`),
        );
      }
      if (limits.max < limits.initial) {
        r = combineResults(
          r,
          this.printError(
            loc,
            `max ${desc} (${limits.max}) must be >= initial ${desc} (${limits.initial})`,
          ),
        );
      }
    }
    return r;
  }

  private checkLimits64(loc: Location, limits: Limits, absoluteMax: bigint, desc: string): Result {
    const init = BigInt(limits.initial);
    const max = limits.max !== undefined ? BigInt(limits.max) : undefined;
    let r: Result = Result.Ok;
    if (init > absoluteMax) {
      r = combineResults(
        r,
        this.printError(loc, `initial ${desc} (${init}) must be <= (${absoluteMax})`),
      );
    }
    if (max !== undefined) {
      if (max > absoluteMax) {
        r = combineResults(
          r,
          this.printError(loc, `max ${desc} (${max}) must be <= (${absoluteMax})`),
        );
      }
      if (max < init) {
        r = combineResults(
          r,
          this.printError(loc, `max ${desc} (${max}) must be >= initial ${desc} (${init})`),
        );
      }
    }
    return r;
  }
}
