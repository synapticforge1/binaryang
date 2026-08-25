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
import { CatchKind, isRefValueType, valueTypeName, varIndex } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

/**
 * Options for {@link validateModule}.
 *
 * Started as a placeholder for future feature flags and is no longer one:
 * `features` is load-bearing, and leaving it at the default silently
 * rejects valid modules that use a proposal (see the field below).
 */
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
  /**
   * While validating a GLOBAL's initializer: how many globals are in scope.
   * A global's own index is not, which is what makes a self-reference an
   * unknown global rather than a cycle. Undefined for every other kind of
   * constant expression, where no such limit applies.
   */
  private initExprGlobalLimit: number | undefined = undefined;

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

  /**
   * Reject a construct whose proposal the caller has not enabled.
   *
   * `Features` is public API, and for nine proposals it did NOTHING:
   * `defaultFeatures()` says `gc: false` and a GC module validated anyway. A
   * flag that gates nothing is the same class as a check that reads as covered
   * and is inert — the caller believes it has refused something it has not
   * (T13.10).
   *
   * Gate at the point of USE, not from a post-hoc scan, so a construct
   * reachable by any path is caught: an imported 64-bit memory needs the
   * proposal exactly as much as a defined one.
   */
  requireFeature(flag: keyof Features, proposal: string, loc: Location): Result {
    if (this.features[flag]) return Result.Ok;
    return this.printError(loc, `${proposal} not allowed: enable the ${flag} feature`);
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

  /**
   * A type's subtyping DEPTH — its number of ancestors — may not exceed 63.
   *
   * This is an implementation limit the GC proposal fixes so a subtype check
   * can be O(1) (a depth-indexed display rather than a walk), and **both
   * engines enforce it**: Wasmtime rejects, and V8 says
   * `type 64: subtyping depth is greater than 63`. We accepted chains of any
   * length, so a 2000-deep chain validated clean here and loaded nowhere
   * (T13.34).
   *
   * Must be called after the whole type section is registered — a type may
   * legally name a supertype declared later in its own rec group.
   *
   * **It also reports supertype CYCLES**, because nothing else did. `$a`
   * extending `$b` extending `$a`, a 3-cycle, and the self-referential
   * `$a extending $a` all validated clean here and are rejected by both
   * Wasmtime and V8 (`type 0: invalid supertype`). The first draft of this
   * method assumed "the ordinary subtype checks report the cycle" and said so
   * in a comment; checking that assumption rather than trusting it is what
   * found the second half of T13.34.
   *
   * The depth walk already has to detect cycles to terminate, so reporting
   * them is free — `inProgress` marks the nodes on the current path, and
   * meeting one again IS the cycle.
   */
  checkSubtypingDepth(loc: Location): Result {
    const MAX_SUBTYPING_DEPTH = 63;
    const depth = new Map<number, number>();
    const inProgress = new Set<number>();
    const cyclic = new Set<number>();

    const depthOf = (idx: number): number => {
      const memo = depth.get(idx);
      if (memo !== undefined) return memo;
      if (inProgress.has(idx)) {
        // Meeting a node already on the current path IS the cycle. Record it
        // and unwind with 0 so the walk terminates; it is reported below.
        cyclic.add(idx);
        return 0;
      }
      const info = this.heapTypesMap.get(idx);
      if (info === undefined || info.supers.length === 0) {
        depth.set(idx, 0);
        return 0;
      }
      inProgress.add(idx);
      let best = 0;
      for (const s of info.supers) best = Math.max(best, depthOf(s) + 1);
      inProgress.delete(idx);
      depth.set(idx, best);
      return best;
    };

    let r: Result = Result.Ok;
    for (const idx of this.heapTypesMap.keys()) depthOf(idx);
    for (const idx of [...cyclic].sort((a, b) => a - b)) {
      r = combineResults(
        r,
        this.printError(loc, `type ${idx}: invalid supertype (cycle in the subtyping chain)`),
      );
    }
    for (const idx of this.heapTypesMap.keys()) {
      if (cyclic.has(idx)) continue; // its depth is meaningless
      const d = depthOf(idx);
      if (d > MAX_SUBTYPING_DEPTH) {
        r = combineResults(
          r,
          this.printError(
            loc,
            `type ${idx}: subtyping depth ${d} is greater than the maximum ${MAX_SUBTYPING_DEPTH}`,
          ),
        );
      }
    }
    return r;
  }

  checkValueType(loc: Location, vt: ValueType, what: string, bound = this.numTypes): Result {
    if (!isRefValueType(vt)) {
      // A GC abstract heap type is as much "using the proposal" as a
      // `struct.new` is. Gating only the INSTRUCTIONS left `(param anyref)`,
      // `(result anyref)` and `ref.null any` accepted with `gc: false` — and
      // with them `any.convert_extern` / `extern.convert_any`, which have no
      // delegate hook of their own and were reachable only through their
      // anyref result (T13.10).
      //
      // `funcref` and `externref` are REFERENCE TYPES, not GC, and must not be
      // caught here — they are ratified and on by default.
      switch (vt) {
        case Type.AnyRef:
        case Type.EqRef:
        case Type.I31Ref:
        case Type.StructRef:
        case Type.ArrayRef:
        case Type.NullRef:
        case Type.NullFuncRef:
        case Type.NullExternRef:
          return this.requireFeature('gc', `GC reference type in ${what}`, loc);
        case Type.ExnRef:
        case Type.NullExnRef:
          return this.requireFeature('exceptions', `exception reference in ${what}`, loc);
        default:
          return Result.Ok;
      }
    }
    // A CONCRETE typed reference `(ref $T)` is the function-references
    // proposal, whichever kind of type it names.
    const rf = this.requireFeature('functionReferences', `typed reference in ${what}`, loc);
    if (rf !== Result.Ok) return rf;
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
    loc: Location,
    fields: Field[] = [],
    supers: number[] = [],
    canon = '',
  ): Result {
    const r = this.requireFeature('gc', 'struct type', loc);
    this.structTypesMap.set(this.numTypes, fields);
    this.heapTypesMap.set(this.numTypes, { kind: 'struct', supers, canon });
    this.numTypes++;
    return r;
  }

  onArrayType(
    loc: Location,
    element?: Field,
    supers: number[] = [],
    canon = '',
  ): Result {
    const r = this.requireFeature('gc', 'array type', loc);
    if (element) this.arrayTypesMap.set(this.numTypes, element);
    this.heapTypesMap.set(this.numTypes, { kind: 'array', supers, canon });
    this.numTypes++;
    return r;
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
    if (limits.is64) {
      r = combineResults(r, this.requireFeature('memory64', '64-bit table', loc));
    }
    // The element bound follows the INDEX TYPE: a 32-bit table tops out at
    // 2^32-1 entries, a 64-bit one at 2^64-1. A flat u32 cap rejected
    // `(table i64 0 0x1_0000_0000 funcref)`, which table64.wast declares
    // valid — invisible until the writer stopped truncating 64-bit limits to
    // u32, which is what had been keeping the value away from this check.
    r = combineResults(
      r,
      this.checkLimits64(loc, limits, limits.is64 ? (1n << 64n) - 1n : 0xffff_ffffn, 'elems'),
    );
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
    if (limits.isShared) {
      r = combineResults(r, this.requireFeature('threads', 'shared memory', loc));
    }
    if (limits.is64) {
      r = combineResults(r, this.requireFeature('memory64', '64-bit memory', loc));
    }
    // Page size (custom-page-sizes): exactly 1 or 65536 — log2 of 0 or 16 —
    // and NOTHING between. The field is already a log2, so every value looks
    // like a power of two by construction; a power-of-two test here would
    // accept the fourteen sizes the spec rejects. Checked before the ceiling
    // below, which divides by it.
    const psLog2 = limits.pageSizeLog2 ?? 16;
    if (psLog2 !== 0 && psLog2 !== 16) {
      r = combineResults(
        r,
        this.printError(loc, `invalid page size: 2^${psLog2}, must be 1 or 65536`),
      );
    } else if (limits.pageSizeLog2 !== undefined && !this.features.customPageSizes) {
      // Gated on PRESENCE: both the `(pagesize N)` syntax and the flag bit come
      // from the proposal, so an explicit `pagesize 65536` needs it too even
      // though it names the standard size.
      r = combineResults(r, this.printError(loc, 'custom page sizes not allowed'));
    }
    // The page LIMIT, not the representable range: a memory's BYTE size has to
    // fit its index space, so the ceiling is 2^32 / pageSize for a 32-bit
    // memory and 2^64 / pageSize for a 64-bit one. It used to be the constant
    // 65536 (= 2^32 / 65536) with the division already done, which is right
    // only for the standard page size: with 1-byte pages a 32-bit memory may
    // legitimately declare 2^32 PAGES, and the constant rejected the
    // proposal's own valid modules.
    const shift = (limits.is64 ? 64 : 32) - (psLog2 === 0 || psLog2 === 16 ? psLog2 : 16);
    // A 64-bit memory with 1-byte pages wants a ceiling of 2^64, which is
    // every u64 — express it as the maximum rather than shifting past the
    // width.
    const absMax = shift >= 64 ? (1n << 64n) - 1n : 1n << BigInt(shift);
    r = combineResults(r, this.checkLimits64(loc, limits, absMax, 'pages'));
    // `!limits.max` also fired on a max of ZERO, so `(memory 0 0 shared)` was
    // reported as having no maximum at all.
    if (limits.isShared && limits.max === undefined) {
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
    const rf = this.requireFeature('exceptions', 'tag', loc);
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
    return rf;
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

  onElemSegmentElemType(loc: Location, elemType: ValueType): Result {
    const elem = this.elems[this.elems.length - 1];
    if (!elem) return Result.Ok;
    elem.element = elemType;
    // An ACTIVE segment's element type must fit the table it initialises.
    // Nothing compared them, so a nullable `funcref` segment against a
    // `(ref func)` table validated — the case elem.wast asserts invalid.
    if (elem.isActive && !this.isSubtype(elemType, elem.tableType)) {
      return this.printError(
        loc,
        `type mismatch: element segment of type ${
          valueTypeName(elemType)
        } does not fit a table of type ${valueTypeName(elem.tableType)}`,
      );
    }
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

  /** Like {@link beginInitExpr}, but for a global's own initializer. */
  beginGlobalInitExpr(loc: Location, type: ValueType, globalIdx: number): Result {
    this.initExprGlobalLimit = globalIdx;
    return this.beginInitExpr(loc, type);
  }

  beginInitExpr(loc: Location, typeIn: ValueType): Result {
    const type = typeIn;
    this.currentLoc = loc;
    this.inInitExpr = true;
    return this.tc.beginInitExpr(type);
  }

  endInitExpr(): Result {
    this.inInitExpr = false;
    this.initExprGlobalLimit = undefined;
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
      const r = this.tc.beginFunction(ft.params, ft.results);
      // Params are always initialised. Locals are seeded in `onLocalDecl`,
      // which runs after this.
      this.tc.setInitialLocals(ft.params.map((_, i) => i));
      return r;
    }
    this.tc.setInitialLocals([]);
    return this.tc.beginFunction([], []);
  }

  endFunctionBody(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.endFunction();
  }

  onLocalDecl(_loc: Location, count: number, typeIn: ValueType): Result {
    const type = typeIn;
    // A defaultable local starts initialised; a non-defaultable one does not.
    if (SharedValidator.isDefaultable(type)) {
      const base = this.locals.length === 0 ? 0 : (this.locals[this.locals.length - 1]?.end ?? 0);
      for (let i = 0; i < count; i++) this.tc.markLocalInit(base + i);
    }
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

  /**
   * A one-armed `if` — no `else` — falls through producing whatever it was
   * given, so its block type's PARAMS and RESULTS must match. `(if (result
   * i32) (then …))` with no else has nothing to produce on the false path.
   * Nothing checked this; the missing else was simply not modelled.
   */
  onOneArmedIf(loc: Location, blockType: BlockType): Result {
    const { params, results } = this.resolveBlockType(blockType, loc);
    if (params.length !== results.length) {
      return this.printError(
        loc,
        'type mismatch: a one-armed if must start and end with the same arity',
      );
    }
    for (const [i, p] of params.entries()) {
      if (!this.isSubtype(p, results[i]!)) {
        return this.printError(
          loc,
          'type mismatch: a one-armed if must start and end with the same types',
        );
      }
    }
    return Result.Ok;
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
    // rt2 must be a SUBTYPE of rt1 — the instruction narrows a reference, it
    // cannot widen one. Nothing checked the relationship between the two
    // immediates, so `br_on_cast … (ref any) (ref null $s)` validated even
    // though a nullable ref is not a subtype of a non-nullable one.
    let r: Result = Result.Ok;
    if (!this.isSubtype(to, from)) {
      r = this.printError(
        loc,
        `type mismatch in br_on_cast: ${valueTypeName(to)} is not a subtype of ${
          valueTypeName(from)
        }`,
      );
    }
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
    return combineResults(
      r,
      this.tc.onBrOnCast(
        depth,
        onFail ? 'br_on_cast_fail' : 'br_on_cast',
        onFail ? diff : to,
        onFail ? to : diff,
      ),
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

  onSelect(loc: Location, resultTypes: ValueType[]): Result {
    this.currentLoc = loc;
    if (resultTypes.length > 1) {
      return this.printError(loc, `invalid arity in select instruction: ${resultTypes.length}.`);
    }
    // The annotation carries value types written INSIDE an instruction, and
    // the module-level index walk only covers DECLARATIONS — so an
    // out-of-range heap index here went unreported.
    // `(select (result (ref 1)))` in a one-type module is exactly that.
    let r: Result = Result.Ok;
    for (const t of resultTypes) {
      r = combineResults(r, this.checkValueType(loc, t, 'select result'));
    }
    return combineResults(r, this.tc.onSelect(resultTypes));
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — locals / globals
  // ---------------------------------------------------------------------------

  onLocalGet(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    if (!this.tc.isLocalInit(localIdx)) {
      return this.printError(loc, `uninitialized local ${localIdx}`);
    }
    return this.tc.onLocalGet(type);
  }

  onLocalSet(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    this.tc.markLocalInit(localIdx);
    return this.tc.onLocalSet(type);
  }

  onLocalTee(loc: Location, localIdx: number): Result {
    this.currentLoc = loc;
    const type = this.checkLocalIndex(localIdx, loc);
    if (type === null) return Result.Error;
    this.tc.markLocalInit(localIdx);
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
      } else if (this.initExprGlobalLimit !== undefined && globalIdx >= this.initExprGlobalLimit) {
        // Even relaxed, a global may only reference globals declared BEFORE
        // it. `(global $g i32 (global.get 0))` names ITSELF: index 0 is not
        // in scope until its own initializer finishes. Only the
        // imported-global rule was checked, so the relaxed path let it
        // through.
        r = combineResults(r, this.printError(loc, `unknown global ${globalIdx}`));
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
  //
  // INTENT OF THIS WHOLE FAMILY: every handler that takes a memarg owes the
  // SAME four things, and each one is a separate defect if omitted —
  //
  //   1. resolve the memory index (`checkMemoryIndex`);
  //   2. check `align` against the opcode's natural alignment, via
  //      `naturalAlignForOpcode` in `core/opcode.ts` and NO other table;
  //   3. check `offset` fits the memory's index type (`checkMemArgOffset`);
  //   4. pass `is64` down to the type checker so the ADDRESS operand is i64
  //      on a 64-bit memory.
  //
  // This list exists because the family has been audited three times and each
  // audit checked one item: T9.6 found (2) missing, T9.11 found (3) missing in
  // ten of twelve handlers, and T13.15 then found (4) missing in two of those
  // same ten — an audit along one axis certifies one axis. If a parameter here
  // is unused, that is the missing check, not a tidy signature; do not silence
  // it with an underscore.
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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

  /**
   * Does this element type hold FUNCTION references? True for `funcref`,
   * `nullfuncref`, `(ref [null] func)` and `(ref [null] $t)` where `$t` is a
   * func type — and false for every other hierarchy.
   */
  private isFuncTable(t: ValueType): boolean {
    if (!isRefValueType(t)) return t === Type.FuncRef || t === Type.NullFuncRef;
    const h = t.heapType;
    if (h.kind === 'name') return h.name === 'func' || h.name === 'nofunc';
    return this.funcTypesMap.has(h.value);
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
    // The table must hold FUNCTION references specifically. Accepting any
    // reference let `(table 10 externref)` back a `call_indirect`.
    if (tt && !this.isFuncTable(tt.element)) {
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
    // The callee is `(ref null $t)` for the NAMED type, not any funcref.
    // Expecting `funcref` let a plain `funcref` operand through, so
    // `(func (param funcref) (local.get 0) (call_ref $t))` validated.
    return this.tc.onCallRef(this.refNullTo(sigIdx), ft.params, ft.results);
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
    // Same table-kind rule as call_indirect — it was only applied there.
    if (tt && !this.isFuncTable(tt.element)) {
      r = combineResults(
        r,
        this.printError(
          loc,
          'type mismatch: return_call_indirect must reference table of funcref type',
        ),
      );
    }
    if (ft) {
      // And a 64-bit table is indexed by i64, which was hard-coded false.
      r = combineResults(
        r,
        this.tc.onReturnCallIndirect(ft.params, ft.results, tt?.limits.is64 ?? false),
      );
    }
    return r;
  }

  onReturnCallRef(loc: Location, sigIdx: number): Result {
    this.currentLoc = loc;
    const ft = this.checkFuncTypeIndex(sigIdx, loc);
    if (!ft) return Result.Error;
    // The callee is `(ref null $t)` for the NAMED type, not any funcref.
    // Expecting `funcref` let a plain `funcref` operand through, so
    // `(func (param funcref) (local.get 0) (call_ref $t))` validated.
    return this.tc.onReturnCallRef(this.refNullTo(sigIdx), ft.params, ft.results);
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

  onStructGet(loc: Location, typeIdx: number, fieldIdx: number, signed?: boolean): Result {
    this.currentLoc = loc;
    const st = this.checkStructTypeIndex(typeIdx, loc);
    if (!st) return Result.Error;
    const field = st.fields[fieldIdx];
    if (field === undefined) {
      this.printError(loc, `field index ${fieldIdx} out of range for struct type ${typeIdx}`);
      return Result.Error;
    }
    return combineResults(
      this.checkPackedAccess(loc, field.type, signed, 'struct.get', `field ${fieldIdx}`),
      this.tc.onCall([this.refNullTo(typeIdx)], [packedToStackType(field.type)]),
    );
  }

  /**
   * `_s` / `_u` is legal on a PACKED field or element and required there; the
   * plain spelling is legal only on an unpacked one.
   *
   * `signed` is a tri-state: `undefined` is the plain `get`, `true` is `_s`,
   * `false` is `_u` — the same encoding both writers already read. The struct
   * handler took the flag and named it `_signed`, i.e. declared and dropped
   * it, and the array handler did not take it at all, so all four illegal
   * combinations validated. Same shape as T9.11's ten unused `offset`
   * parameters: a check that reads as covered and does nothing (T13.14).
   */
  private checkPackedAccess(
    loc: Location,
    fieldType: ValueType,
    signed: boolean | undefined,
    op: string,
    what: string,
  ): Result {
    const packed = fieldType === Type.I8 || fieldType === Type.I16;
    if (packed && signed === undefined) {
      return this.printError(
        loc,
        `${op} on packed ${what} requires the _s or _u form`,
      );
    }
    if (!packed && signed !== undefined) {
      return this.printError(
        loc,
        `${op}_${signed ? 's' : 'u'} is only valid on a packed (i8 / i16) ${what}`,
      );
    }
    return Result.Ok;
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

  /**
   * `array.new_data` / `array.init_data` copy raw BYTES, so the element has to
   * be numeric or vector; `array.new_elem` / `array.init_elem` copy element
   * expressions, so it has to be a reference. Neither was checked, so
   * `array.init_data` on an array of `funcref` — and `array.init_elem` on an
   * array of `i8` — validated clean.
   */
  /** The elem segment's element type must fit the array's. */
  private checkSegmentFitsArray(
    loc: Location,
    segElem: ValueType,
    arrayElem: ValueType,
    what: string,
  ): Result {
    if (this.isSubtype(segElem, arrayElem)) return Result.Ok;
    return this.printError(
      loc,
      `type mismatch in ${what}: segment type ${valueTypeName(segElem)} is not a subtype of ${
        valueTypeName(arrayElem)
      }`,
    );
  }

  private checkArrayElemKind(
    loc: Location,
    element: ValueType,
    wantReference: boolean,
    what: string,
  ): Result {
    const isRef = isRefValueType(element) || isReferenceType(element);
    if (isRef === wantReference) return Result.Ok;
    return this.printError(
      loc,
      wantReference
        ? `${what} can only be used with reference-type arrays`
        : `array type is not numeric or vector: ${what} needs a numeric element`,
    );
  }

  onArrayNewData(loc: Location, typeIdx: number, dataIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const dataCheck = this.checkDataSegmentIndex(dataIdx, loc);
    if (dataCheck !== Result.Ok) return dataCheck;
    const kindCheck = this.checkArrayElemKind(loc, at.element.type, false, 'array.new_data');
    return combineResults(kindCheck, this.tc.onCall([Type.I32, Type.I32], [this.refTo(typeIdx)]));
  }

  onArrayNewElem(loc: Location, typeIdx: number, elemIdx: number): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    const elemCheck = this.checkElemSegmentIndex(elemIdx, loc);
    if (!elemCheck) return Result.Error;
    const kindCheck = combineResults(
      this.checkArrayElemKind(loc, at.element.type, true, 'array.new_elem'),
      this.checkSegmentFitsArray(loc, elemCheck.element, at.element.type, 'array.new_elem'),
    );
    return combineResults(kindCheck, this.tc.onCall([Type.I32, Type.I32], [this.refTo(typeIdx)]));
  }

  onArrayGet(loc: Location, typeIdx: number, signed?: boolean): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    return combineResults(
      this.checkPackedAccess(loc, at.element.type, signed, 'array.get', 'element'),
      this.tc.onCall(
        [this.refNullTo(typeIdx), Type.I32],
        [packedToStackType(at.element.type)],
      ),
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

  onArrayInitSegment(
    loc: Location,
    typeIdx: number,
    isElem: boolean,
    segment?: number,
  ): Result {
    this.currentLoc = loc;
    const at = this.checkArrayTypeIndex(typeIdx, loc);
    if (!at) return Result.Error;
    // [ref, destOffset, srcOffset, size] -> []
    let kindCheck = this.checkArrayElemKind(
      loc,
      at.element.type,
      isElem,
      isElem ? 'array.init_elem' : 'array.init_data',
    );
    if (isElem && segment !== undefined) {
      const seg = this.checkElemSegmentIndex(segment, loc);
      if (seg) {
        kindCheck = combineResults(
          kindCheck,
          this.checkSegmentFitsArray(loc, seg.element, at.element.type, 'array.init_elem'),
        );
      }
    }
    return combineResults(
      kindCheck,
      combineResults(
        this.checkMutable(loc, at.element.mutable, `element of array type ${typeIdx}`),
        this.tc.onCall([this.refNullTo(typeIdx), Type.I32, Type.I32, Type.I32], []),
      ),
    );
  }

  onArrayLen(loc: Location): Result {
    this.currentLoc = loc;
    return this.tc.onArrayLen();
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers — GC ref.test / ref.cast
  // ---------------------------------------------------------------------------

  /**
   * `ref.test (ref [null] H) v` — the type being TESTED FOR has to reach the
   * type checker, exactly as `onRefCast` passes the type being cast to.
   * Without it there was nothing to compare the operand against, so a
   * cross-hierarchy test validated (T13.14).
   */
  onRefTest(loc: Location, testTo: ValueType): Result {
    this.currentLoc = loc;
    return this.tc.onRefTest(testTo);
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
    // The SOURCE element must be assignable to the destination's. The operand
    // stack only carries indices and a count, so it cannot see this.
    let r: Result = Result.Ok;
    if (!this.isSubtype(stt.element, dtt.element)) {
      r = this.printError(
        loc,
        `type mismatch in table.copy: ${valueTypeName(stt.element)} is not a subtype of ${
          valueTypeName(dtt.element)
        }`,
      );
    }
    return combineResults(
      r,
      this.tc.onTableCopy(dtt.limits.is64 ?? false, stt.limits.is64 ?? false),
    );
  }

  onTableInit(loc: Location, segIdx: number, tableIdx: number): Result {
    this.currentLoc = loc;
    const tt = this.checkTableIndex(tableIdx, loc);
    const et = this.checkElemSegmentIndex(segIdx, loc);
    let r = (tt && et) ? Result.Ok : Result.Error;
    // Same as table.copy: the segment's element type must fit the table's.
    if (tt && et && !this.isSubtype(et.element, tt.element)) {
      r = combineResults(
        r,
        this.printError(
          loc,
          `type mismatch in table.init: ${valueTypeName(et.element)} is not a subtype of ${
            valueTypeName(tt.element)
          }`,
        ),
      );
    }
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

  onRethrow(loc: Location, depth: number): Result {
    this.currentLoc = loc;
    return this.tc.onRethrow(depth);
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
  /**
   * A `try_table` catch clause: bounds-check the tag AND check that the
   * target label accepts exactly what the clause hands it.
   *
   *   catch $tag $l          the tag's params
   *   catch_ref $tag $l      the tag's params, plus an exnref
   *   catch_all $l           nothing
   *   catch_all_ref $l       an exnref
   *
   * Only the tag was checked, so `(catch_ref 0 0)` into a label taking
   * nothing — V8: "catch kind generates 1 operand, target block expects 0" —
   * validated clean.
   */
  onTryTableCatch(
    loc: Location,
    kind: CatchKind,
    tag: number | undefined,
    depth?: number,
  ): Result {
    this.currentLoc = loc;
    let params: ValueType[] = [];
    if (kind === CatchKind.Catch || kind === CatchKind.CatchRef) {
      if (tag === undefined) return Result.Error;
      const tt = this.checkTagIndex(tag, loc);
      if (!tt) return Result.Error;
      params = [...tt.params];
    }
    if (kind === CatchKind.CatchRef || kind === CatchKind.CatchAllRef) {
      // A caught exception reference is NON-NULL — `(ref exn)`, not the
      // nullable `exnref`. There is always an exception when the clause runs.
      params.push({ kind: 'ref', heapType: { kind: 'name', name: 'exn' }, nullable: false });
    }
    if (depth === undefined) return Result.Ok;
    return this.tc.checkCatchTarget(depth, params);
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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
    r = combineResults(
      r,
      this.checkMemArgOffset(loc, offset, mt?.limits.is64 ?? false),
    );
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

  // There used to be a `number` twin of this, dead since `onMemory` and
  // `onTable` moved onto the 64-bit bounds. With `Limits` holding `bigint`
  // there is nothing left for it to do, so it is gone: one rule, one copy.
  private checkLimits64(loc: Location, limits: Limits, absoluteMax: bigint, desc: string): Result {
    const init = limits.initial;
    const max = limits.max;
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
