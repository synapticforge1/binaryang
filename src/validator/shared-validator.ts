// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/shared-validator.cc / include/wabt/shared-validator.h
// Copyright 2020 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import { combineResults, Result } from '../core/result.ts';
import { Type } from '../core/types.ts';
import type { Index } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import { addError, unknownLocation } from '../core/error.ts';
import type { ErrorList, Location } from '../core/error.ts';
import { getOpcodeNaturalAlign, TypeChecker } from './type-checker.ts';
import type { FuncType } from './type-checker.ts';
import type { BlockType, Field, Limits, SegmentKind, ValueType } from '../ir/ir.ts';
import { CatchKind, coarsenValueType } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

// Placeholder for future feature flags. Switched from `interface` to a type
// alias so the deno-lint `no-empty-interface` rule does not flag it.
export type ValidateOptions = Record<string, never>;

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface SVTableType {
  element: Type;
  limits: Limits;
}
interface SVMemoryType {
  limits: Limits;
}
interface SVGlobalType {
  type: Type;
  mutable: boolean;
}
interface SVTagType {
  params: Type[];
}
interface SVElemType {
  element: Type;
  isActive: boolean;
  tableType: Type;
}
interface SVLocalDecl {
  type: Type;
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
function packedToStackType(tIn: ValueType): Type {
  const t = coarsenValueType(tIn);
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

  constructor(errors: ErrorList, _options?: ValidateOptions) {
    this.errors = errors;
    this.tc = new TypeChecker(this.funcTypesMap);
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

  private checkLocalIndex(idx: number, loc: Location): Type | null {
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

  private resolveBlockType(bt: BlockType, loc: Location): { params: Type[]; results: Type[] } {
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

  onFuncType(
    _loc: Location,
    paramsIn: ValueType[],
    resultsIn: ValueType[],
    typeIndex: Index,
  ): Result {
    const params = paramsIn.map(coarsenValueType);
    const results = resultsIn.map(coarsenValueType);
    this.funcTypesMap.set(this.numTypes, { params, results, typeIndex });
    this.numTypes++;
    return Result.Ok;
  }

  onStructType(_loc: Location, fields: Field[] = []): Result {
    this.structTypesMap.set(this.numTypes, fields);
    this.numTypes++;
    return Result.Ok;
  }

  onArrayType(_loc: Location, element?: Field): Result {
    if (element) this.arrayTypesMap.set(this.numTypes, element);
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

  onTable(loc: Location, elemTypeIn: ValueType, limits: Limits): Result {
    const elemType = coarsenValueType(elemTypeIn);
    let r: Result = Result.Ok;
    if (this.tables.length > 0) {
      r = combineResults(r, this.printError(loc, 'only one table allowed'));
    }
    r = combineResults(r, this.checkLimits(loc, limits, 0xFFFFFFFF, 'elems'));
    this.tables.push({ element: elemType, limits });
    return r;
  }

  onMemory(loc: Location, limits: Limits): Result {
    let r: Result = Result.Ok;
    if (this.memories.length > 0) {
      r = combineResults(r, this.printError(loc, 'only one memory block allowed'));
    }
    const absMax = limits.is64 ? 0xFFFFFFFFFFFFFFFFn : 0xFFFFFFFFn;
    r = combineResults(r, this.checkLimits64(loc, limits, absMax, 'pages'));
    if (limits.isShared && !limits.max) {
      r = combineResults(r, this.printError(loc, 'shared memories must have max sizes'));
    }
    this.memories.push({ limits });
    return r;
  }

  onGlobalImport(_loc: Location, typeIn: ValueType, mutable: boolean): Result {
    const type = coarsenValueType(typeIn);
    this.globals.push({ type, mutable });
    this.numImportedGlobals++;
    return Result.Ok;
  }

  onGlobal(_loc: Location, typeIn: ValueType, mutable: boolean): Result {
    const type = coarsenValueType(typeIn);
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
    let tableType: Type = Type.FuncRef;
    if (kind === 'active') {
      const tt = this.checkTableIndex(tableIdx, loc);
      r = combineResults(r, tt ? Result.Ok : Result.Error);
      if (tt) tableType = tt.element;
    }
    this.elems.push({ element: Type.Void, isActive: kind === 'active', tableType });
    return r;
  }

  onElemSegmentElemType(_loc: Location, elemTypeIn: ValueType): Result {
    const elemType = coarsenValueType(elemTypeIn);
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
    const type = coarsenValueType(typeIn);
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
    const type = coarsenValueType(typeIn);
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

  onBrOnCast(loc: Location, depth: number, onFail: boolean): Result {
    this.currentLoc = loc;
    return this.tc.onBrOnCast(depth, onFail ? 'br_on_cast_fail' : 'br_on_cast');
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
    const resultTypes = resultTypesIn.map(coarsenValueType);
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
      if (globalIdx >= this.numImportedGlobals) {
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

  onLoad(loc: Location, opcode: number, memIdx: number, align: number, _offset: bigint): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onLoad(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onStore(loc: Location, opcode: number, memIdx: number, align: number, _offset: bigint): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onStore(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onLoadSplat(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onLoadSplat(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onLoadZero(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
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
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicLoad(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicStore(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicStore(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicRmw(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicRmw(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicRmwCmpxchg(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicRmwCmpxchg(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicWait(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAtomicAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onAtomicWait(opcode, mt?.limits.is64 ?? false));
    return r;
  }

  onAtomicNotify(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
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
    if (tt && tt.element !== Type.FuncRef) {
      r = combineResults(
        r,
        this.printError(loc, 'type mismatch: call_indirect must reference table of funcref type'),
      );
    }
    if (ft) {
      r = combineResults(r, this.tc.onCallIndirect(ft.params, ft.results, false));
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

  onRefNull(loc: Location, refType: Type): Result {
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
    r = combineResults(r, this.tc.onRefFunc());
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
    return this.tc.onCall(stackParams, [Type.Ref]);
  }

  onStructNewDefault(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    return this.tc.onCall([], [Type.Ref]);
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
    return this.tc.onCall([Type.Ref], [packedToStackType(field.type)]);
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
    return this.tc.onCall([Type.Ref, packedToStackType(field.type)], []);
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
    return this.tc.onCall([packedToStackType(at.element.type), Type.I32], [Type.Ref]);
  }

  onArrayNewDefault(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return this.tc.onCall([Type.I32], [Type.Ref]);
  }

  onArrayNewFixed(loc: Location, typeIdx: number, count: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const elem = packedToStackType(at.element.type);
    const params: Type[] = [];
    for (let i = 0; i < count; i++) params.push(elem);
    return this.tc.onCall(params, [Type.Ref]);
  }

  onArrayNewData(loc: Location, typeIdx: number, dataIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const dataCheck = this.checkDataSegmentIndex(dataIdx, loc);
    if (dataCheck !== Result.Ok) return dataCheck;
    return this.tc.onCall([Type.I32, Type.I32], [Type.Ref]);
  }

  onArrayNewElem(loc: Location, typeIdx: number, elemIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const elemCheck = this.checkElemSegmentIndex(elemIdx, loc);
    if (!elemCheck) return Result.Error;
    return this.tc.onCall([Type.I32, Type.I32], [Type.Ref]);
  }

  onArrayGet(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return this.tc.onCall([Type.Ref, Type.I32], [packedToStackType(at.element.type)]);
  }

  onArraySet(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return this.tc.onCall([Type.Ref, Type.I32, packedToStackType(at.element.type)], []);
  }

  onArrayFill(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // [ref, offset, value, size] -> []
    return this.tc.onCall(
      [Type.Ref, Type.I32, packedToStackType(at.element.type), Type.I32],
      [],
    );
  }

  onArrayCopy(loc: Location, destTypeIdx: number, srcTypeIdx: number): Result {
    this.currentLoc = loc;
    const dest = this.checkArrayTypeIndex(destTypeIdx, loc);
    const src = this.checkArrayTypeIndex(srcTypeIdx, loc);
    if (!dest || !src) return Result.Error;
    // [destRef, destOffset, srcRef, srcOffset, size] -> []
    return this.tc.onCall([Type.Ref, Type.I32, Type.Ref, Type.I32, Type.I32], []);
  }

  onArrayInitSegment(loc: Location, typeIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // [ref, destOffset, srcOffset, size] -> []
    return this.tc.onCall([Type.Ref, Type.I32, Type.I32, Type.I32], []);
  }

  onArrayLen(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onCall([Type.Ref], [Type.I32]);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — GC ref.test / ref.cast
  // ---------------------------------------------------------------------------

  // The cast target's precise type doesn't make it into wabt-ts's flat
  // `Type[]` operand model yet (typed-ref IR is the deferred refactor), so
  // these handlers simply pop a ref and push i32 / ref. V8 enforces the
  // precise GC subtyping at runtime; wabt-ts's validator only sees the
  // coarse shape.
  onRefTest(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onCall([Type.Ref], [Type.I32]);
  }
  onRefCast(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onCall([Type.Ref], [Type.Ref]);
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — tables
  // ---------------------------------------------------------------------------

  onTableGet(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableGet(tt.element);
  }

  onTableSet(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableSet(tt.element);
  }

  onTableGrow(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableGrow(tt.element);
  }

  onTableSize(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const r = this.checkIndex(tableIdx, this.tables.length, 'table', loc);
    if (r !== Result.Ok) return r;
    return this.tc.onTableSize();
  }

  onTableFill(loc: Location, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    if (!tt) return Result.Error;
    return this.tc.onTableFill(tt.element);
  }

  onTableCopy(loc: Location, dstIdx: number, srcIdx: number): Result {
    this.currentLoc = loc;
    const dtt = this.checkTableIndex(dstIdx, loc);
    const stt = this.checkTableIndex(srcIdx, loc);
    if (!dtt || !stt) return Result.Error;
    return this.tc.onTableCopy(false, false);
  }

  onTableInit(loc: Location, segIdx: number, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    const et = this.checkElemSegmentIndex(segIdx, loc);
    let r = (tt && et) ? Result.Ok : Result.Error;
    r = combineResults(r, this.tc.onTableInit(false));
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
    _offset: bigint,
    _lane: number,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onSimdLoadLane(mt?.limits.is64 ?? false));
    return r;
  }

  onSimdStoreLane(
    loc: Location,
    opcode: number,
    memIdx: number,
    align: number,
    _offset: bigint,
    _lane: number,
  ): Result {
    this.currentLoc = loc;
    const mt = this.checkMemoryIndex(memIdx, loc);
    let r = mt ? Result.Ok : Result.Error;
    const natAlign = getOpcodeNaturalAlign(opcode);
    if (natAlign > 0) r = combineResults(r, this.checkAlign(loc, align, natAlign));
    r = combineResults(r, this.tc.onSimdStoreLane(mt?.limits.is64 ?? false));
    return r;
  }

  onSimdShuffleOp(loc: Location, _opcode: number): Result {
    this.currentLoc = loc;
    return this.tc.onSimdShuffleOp();
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
