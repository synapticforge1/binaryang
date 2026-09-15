// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Phase 7 — wabt IR → binaryen-ts IR bridge.
 *
 * `bridgeToBinaryen(module)` walks a wabt-ts {@link Module} post-order and
 * builds an equivalent binaryen-ts {@link WasmModule} via the constructor API
 * in `@jrmarcum/binaryang/ir/binaryen-ts`. The output can then be optimized via
 * binaryen-ts passes or emitted as a wasm binary via
 * `encodeWasm(...)` from `@jrmarcum/binaryang/encoder`.
 *
 * **Scope as of this commit (MVP, expanded as expression families come up):**
 * - Imports: func, global, memory, table (no tag).
 * - Module items: defined memories, globals, functions, exports of funcs +
 *   globals.
 * - Expression kinds inside functions and constant init exprs:
 *   `const` (i32 / i64 / f32 / f64), `local.get`, `binary`. Anything else
 *   throws — extend `bridgeExpr` as needed; the throw points to the missing
 *   case.
 *
 * **Out of scope (will throw):** exports of tag, multi-memory, custom
 * sections, and an element-segment entry that is not a plain `ref.func`
 * (binaryen-ts's ElementSegment holds function names). ⚠️ This list has been
 * wrong twice, both times by claiming a throw where the bridge stayed silent —
 * GC instructions ARE bridged (`struct.*`, `array.*`, and the heap types
 * registered above), and element segments and the start function were SILENTLY
 * DROPPED until 2026-09-15: `module.elemSegments` and `module.start` were never
 * read, so a bridged module's tables were empty (every `call_indirect` trapped
 * with "null function") and a start function never ran. Invisible to
 * `deno task bridge`, which compiles the result and never runs it. Both are
 * bridged now, under tests that RUN the module (tests/bridge/module_surface).
 * The rest of this list is still unverified — a row here is a claim, not
 * evidence.
 *
 * Direct recursion is the natural shape here: binaryen-ts constructors are
 * bottom-up (leaves passed into composite constructors), and wabt-ts's IR is
 * already a tree with no upward references — so a single recursive walk
 * suffices. An `ExprVisitorDelegate`-driven version would need an operand
 * stack and is strictly more complex with no benefit.
 */

import { ExternalKind } from '../wabt-ts/core/binary.ts';
import { heapTypeNameToType, Type } from '../wabt-ts/core/types.ts';
import {
  CatchKind,
  coarsenValueType,
  isRefValueType,
  varIndex,
  varName,
} from '../wabt-ts/ir/ir.ts';
import type { HeapTypeRef, TableCatch, ValueType } from '../wabt-ts/ir/ir.ts';
import type {
  ArrayGetExpr,
  ArrayLenExpr,
  ArrayNewDataExpr,
  ArrayNewElemExpr,
  ArrayNewExpr,
  ArrayNewFixedExpr,
  ArraySetExpr,
  BinaryExpr,
  BlockExpr,
  BlockType,
  BrExpr,
  BrOnExpr,
  BrTableExpr,
  CallExpr,
  CallIndirectExpr,
  Const,
  ConstExpr,
  DropExpr,
  ElemSegment,
  Export as WabtExport,
  Expr,
  ExternConvertExpr,
  Func as WabtFunc,
  FuncSignature,
  Global as WabtGlobal,
  GlobalGetExpr,
  GlobalSetExpr,
  I31GetExpr,
  IfExpr,
  Import as WabtImport,
  LoadExpr,
  LoadSplatExpr,
  LocalGetExpr,
  LocalSetExpr,
  LocalTeeExpr,
  LoopExpr,
  MemoryCopyExpr,
  MemoryFillExpr,
  MemoryGrowExpr,
  MemorySizeExpr,
  Module as WabtModule,
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
  Tag as WabtTag,
  ThrowExpr,
  ThrowRefExpr,
  TryExpr,
  TryTableExpr,
  UnaryExpr,
  Var,
} from '../wabt-ts/ir/ir.ts';

import {
  BrOnOp,
  ExpressionKind,
  makeArrayGet,
  makeArrayLen,
  makeArrayNew,
  makeArrayNewData,
  makeArrayNewDefault,
  makeArrayNewElem,
  makeArrayNewFixed,
  makeArraySet,
  makeBinary,
  makeBlock,
  makeBreak,
  makeBrOn,
  makeCall,
  makeCallIndirect,
  makeDrop,
  makeExternConvert,
  makeF32Const,
  makeF64Const,
  makeGlobalGet,
  makeGlobalSet,
  makeI31Get,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLoad,
  makeLocalGet,
  makeLocalSet,
  makeLocalTee,
  makeLoop,
  makeMemoryCopy,
  makeMemoryFill,
  makeMemoryGrow,
  makeMemorySize,
  makeNop,
  makePop,
  makeRefCast,
  makeRefEq,
  makeRefFunc,
  makeRefI31,
  makeRefIsNull,
  makeRefNull,
  makeRefTest,
  makeRegion,
  makeRethrow,
  makeReturn,
  makeSelect,
  makeSIMDExtract,
  makeSIMDLoad,
  makeSIMDLoadStoreLane,
  makeSIMDReplace,
  makeSIMDShuffle,
  makeStore,
  makeStructGet,
  makeStructNew,
  makeStructNewDefault,
  makeStructSet,
  makeSwitch,
  makeThrow,
  makeThrowRef,
  makeTry,
  makeTryTable,
  makeUnary,
  makeUnreachable,
  makeV128Const,
  ModuleBuilder,
  None,
  SIMDLoadOp,
  type TryCatch,
  typeOf,
  ValType,
} from '../binaryen-ts/ir/index.ts';
import type {
  CatchClause,
  Expression,
  HeapType,
  Local,
  RegionExpr,
  Type as BType,
  ValueType as BValueType,
  WasmModule,
} from '../binaryen-ts/ir/index.ts';

import { wabtTypeToValType } from './type-map.ts';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a binaryen-ts {@link WasmModule} from a wabt-ts {@link WabtModule}.
 *
 * Pre-conditions:
 * - Names in cross-references (exports, calls, etc.) must already be
 *   resolved or carry valid names; pass the wabt module through
 *   `resolveNames` if it came from a name-bearing source (WAT parser).
 */
export function bridgeToBinaryen(module: WabtModule): WasmModule {
  const b = new ModuleBuilder();
  const ctx = makeRootCtx(module);

  // GC: register every struct/array type with binaryen-ts up-front. The
  // returned heap-type indices may not match wabt's type-section indices
  // (binaryen-ts indices skip `func` entries; wabt's include them). Record
  // the mapping in ctx so struct/array instructions can resolve it.
  for (let i = 0; i < module.types.length; i++) {
    const t = module.types[i]!;
    if (t.kind === 'struct') {
      const heapIdx = b.addHeapType({
        kind: 'struct',
        fields: t.fields.map((f) => ({
          type: wabtFieldTypeToValType(f.type),
          mutable: f.mutable,
        })),
      });
      ctx.heapTypeIdx[i] = heapIdx;
    } else if (t.kind === 'array') {
      const heapIdx = b.addHeapType({
        kind: 'array',
        element: {
          type: wabtFieldTypeToValType(t.field.type),
          mutable: t.field.mutable,
        },
      });
      ctx.heapTypeIdx[i] = heapIdx;
    }
  }

  // Declare a `func` heap type for every function signature, but ONLY when the
  // module already has a struct/array heap type.
  //
  // INTENT: binaryen-ts's encoder switches on `heapTypes.length > 0` -- once a
  // module declares ANY heap type, EVERY function's type index is resolved by
  // `gcFuncTypeIndex`, which searches for a declared `func` entry matching the
  // signature exactly and throws `unresolved GC function type` when it finds
  // none. That applies to plain `() -> ()` in a GC module too, not only to
  // GC-typed signatures.
  //
  // The guard is load-bearing in the other direction: registering func types
  // unconditionally would make `heapTypes` non-empty for EVERY module and
  // switch non-GC modules onto the GC path as well. They must keep using
  // `getTypeIndex`.
  //
  // Appended AFTER the struct/array entries on purpose, so their heap-type
  // indices -- which instruction immediates already reference -- do not move.
  if (Object.keys(ctx.heapTypeIdx).length > 0) {
    const seen = new Set<string>();
    const declare = (params: ValueType[], results: ValueType[]): void => {
      const p = params.map((t) => wabtTypeToValueType(t, ctx));
      const r = results.map((t) => wabtTypeToValueType(t, ctx));
      const key = JSON.stringify([p, r]);
      if (seen.has(key)) return;
      seen.add(key);
      b.addHeapType({ kind: 'func', params: p, results: r });
    };
    for (const imp of module.imports) {
      if (imp.kind === ExternalKind.Func) declare(imp.func.sig.params, imp.func.sig.results);
      // A TAG carries a signature too, and `addTag` resolves it through
      // `gcFuncTypeIndex` exactly as a function does. Omitting tags made the
      // tag path work only when some function happened to share the tag's
      // signature — which is exactly how the first version of the T13.50 tag
      // test passed while a tag with a UNIQUE signature still threw
      // `unresolved GC function type`. Green for the wrong reason.
      else if (imp.kind === ExternalKind.Tag) declare(imp.tag.sig.params, imp.tag.sig.results);
    }
    for (const f of module.funcs) declare(f.sig.params, f.sig.results);
    for (const t of module.tags) declare(t.sig.params, t.sig.results);
    // A BLOCKTYPE spelled as a type index needs its func entry declared as
    // well. A block whose result is `(ref $T)` has no other spelling -- wabt's
    // `value` blocktype holds a numeric `Type` with no room for a concrete
    // heap type -- so `br_on_cast`-shaped code reaches here as a `func_type`
    // blocktype referencing a func entry that nothing else declares. Without
    // this the encoder throws `unresolved GC function type: () -> (ref 0)`
    // on a module whose functions and tags were all registered correctly.
    //
    // Every func entry in wabt's type section is declared rather than only the
    // ones a blocktype reaches: the type section IS the module's declared
    // types, so mirroring it needs no expression walk to stay correct.
    for (const t of module.types) {
      if (t.kind === 'func') declare(t.sig.params, t.sig.results);
    }
  }

  // Imports: walk module.imports in order, using the canonical names from
  // ctx (which already substituted synthetic names for any anonymous items).
  // Tracking per-kind cursors keeps the import → ctx name lookup aligned.
  let funcCursor = 0;
  let globalCursor = 0;
  let tableCursor = 0;
  let memoryCursor = 0;
  let tagCursor = 0;
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) bridgeImport(b, imp, ctx.funcNames[funcCursor++]!, ctx);
    else if (imp.kind === ExternalKind.Global) {
      bridgeImport(b, imp, ctx.globalNames[globalCursor++]!, ctx);
    } else if (imp.kind === ExternalKind.Table) {
      bridgeImport(b, imp, ctx.tableNames[tableCursor++]!, ctx);
    } else if (imp.kind === ExternalKind.Memory) {
      bridgeImport(b, imp, ctx.memoryNames[memoryCursor++]!, ctx);
    } else if (imp.kind === ExternalKind.Tag) {
      bridgeImport(b, imp, ctx.tagNames[tagCursor++]!, ctx);
    } else bridgeImport(b, imp, '', ctx);
  }

  for (let i = 0; i < module.memories.length; i++) {
    const m = module.memories[i]!;
    b.addMemory(
      ctx.memoryNames[memoryCursor + i]!,
      limitToNumber(m.limits.initial, 'memory initial'),
      m.limits.max === undefined ? null : limitToNumber(m.limits.max, 'memory maximum'),
      m.limits.isShared,
      m.limits.is64,
    );
  }

  for (let i = 0; i < module.globals.length; i++) {
    bridgeGlobal(b, module.globals[i]!, ctx, ctx.globalNames[globalCursor + i]!);
  }

  for (let i = 0; i < module.tables.length; i++) {
    bridgeTable(b, module.tables[i]!, ctx.tableNames[tableCursor + i]!);
  }

  for (let i = 0; i < module.tags.length; i++) {
    bridgeTag(b, module.tags[i]!, ctx.tagNames[tagCursor + i]!, ctx);
  }

  for (let i = 0; i < module.funcs.length; i++) {
    bridgeFunc(b, module.funcs[i]!, ctx, ctx.funcNames[funcCursor + i]!);
  }

  for (const seg of module.elemSegments) bridgeElemSegment(b, seg, ctx);

  for (const seg of module.dataSegments) bridgeDataSegment(b, seg, ctx);

  for (const exp of module.exports) bridgeExport(b, exp, ctx);

  // The start function runs at instantiation, so dropping it changed what the
  // module DOES before anything else could observe it.
  if (module.start !== undefined) b.setStart(resolveVarName(module.start, ctx.funcNames));

  return b.build();
}

/**
 * Narrow a `Limits` field to the `number` binaryen-ts's builder API takes.
 *
 * The wabt IR keeps limits as `bigint` because a 64-bit memory or table may
 * name a size past 2^53 (T13.2); binaryen-ts's surface is `number`. Anything
 * that would not survive the conversion exactly is REFUSED rather than
 * rounded -- a bridge that quietly halves a table is the same class of bug the
 * bigint change was made to remove.
 */
function limitToNumber(v: bigint, what: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${what} is too large to bridge exactly: ${v}`);
  }
  return Number(v);
}

/**
 * An element segment — the table's contents.
 *
 * 🔧 `module.elemSegments` was never read, so every bridged module's tables
 * were EMPTY. That validates (an empty table is a valid table) and traps at run
 * time with "null function" on the first `call_indirect` through it — invisible
 * to `deno task bridge`, which compiles and never runs. Exactly the defect
 * binaryen-ts's own WAT parser carried ("Element segments are complex; skip for
 * MVP", 45 corpus modules); `tests/bridge/module_surface.test.ts` RUNS them.
 *
 * binaryen-ts's `ElementSegment.data` holds function NAMES, so an entry that is
 * not a plain `ref.func` (a `ref.null`, or any other constant expression) has no
 * representation here and is REFUSED rather than dropped.
 */
function bridgeElemSegment(b: ModuleBuilder, seg: ElemSegment, ctx: BridgeCtx): void {
  const data = seg.elemExprs.map((expr, i) => {
    const only = expr.length === 1 ? expr[0] : undefined;
    if (only === undefined || only.kind !== 'ref.func') {
      const what = only === undefined ? `${expr.length} instructions` : only.kind;
      throw new Error(
        `Bridge: element segment ${seg.name} entry ${i} is ${what}; ` +
          `binaryen-ts element segments hold ref.func entries only`,
      );
    }
    return resolveVarName((only as RefFuncExpr).func, ctx.funcNames);
  });
  // An offset built from more than one instruction has no single expression to
  // hand over. Refuse it the way `bridgeDataSegment` does -- taking `[0]` and
  // ignoring the rest would place the segment at the WRONG INDEX, silently,
  // which is the same class of fault as dropping the segment entirely.
  if (seg.kind === 'active' && seg.offset.length !== 1) {
    throw new Error(
      `Bridge: element segment ${seg.name} has ${seg.offset.length} offset exprs; expected 1`,
    );
  }
  b.addElement({
    name: seg.name,
    mode: seg.kind === 'declared' ? 'declarative' : seg.kind,
    // Passive and declarative segments reach no table; wabt still carries a
    // `tableVar`, and binaryen-ts's field is not optional, so name table 0.
    table: seg.kind === 'active'
      ? resolveVarName(seg.tableVar, ctx.tableNames)
      : (ctx.tableNames[0] ?? ''),
    offset: seg.kind === 'active' ? bridgeExpr(seg.offset[0]!, ctx) : null,
    data,
  });
}

function bridgeTable(b: ModuleBuilder, t: WabtModule['tables'][number], name: string): void {
  b.addTable(
    name,
    wabtTypeToValType(t.elemType),
    limitToNumber(t.limits.initial, 'table initial'),
    t.limits.max === undefined ? null : limitToNumber(t.limits.max, 'table maximum'),
  );
}

function bridgeTag(b: ModuleBuilder, tag: WabtTag, name: string, ctx: BridgeCtx): void {
  // T13.50: precise, not coarsening. A tag parameter of `(ref $T)` coarsened to
  // `structref` makes the tag's signature match no declared func heap type, and
  // the encoder throws `unresolved GC function type`.
  b.addTag(name, tag.sig.params.map((t) => wabtTypeToValueType(t, ctx)));
}

// ---------------------------------------------------------------------------
// Context — name tables + current function frame
// ---------------------------------------------------------------------------

interface BridgeCtx {
  /** Func names indexed by the absolute func index (imports first). */
  funcNames: string[];
  /** Func signatures parallel to `funcNames`. Used by `call` to learn the result type. */
  funcSigs: FuncSignature[];
  /** Global names indexed by the absolute global index (imports first). */
  globalNames: string[];
  /** Global value types, parallel to `globalNames`. Used by global.get / global.set. */
  globalTypes: ValueType[];
  /** Table names indexed by the absolute table index (imports first). Used by `call_indirect`. */
  tableNames: string[];
  /** Memory names indexed by the absolute memory index (imports first). Used by memory exports + data segments. */
  memoryNames: string[];
  /** Tag names indexed by the absolute tag index (imports first). Used by `throw` / `try_table`. */
  tagNames: string[];
  /**
   * Map from wabt type-section index → binaryen-ts heap-type index.
   * Populated by `bridgeToBinaryen` from `module.types`. Indices for `func`
   * type entries are left unset; only struct/array entries register heap
   * types with binaryen-ts.
   */
  heapTypeIdx: Record<number, number>;
  /** Direct reference to the original `module.types` for field-type lookups. */
  types: WabtModule['types'];
  /** Current function param types (set inside bridgeFunc). */
  currentParams: ValueType[];
  /** Current function local types, in slot order after params. */
  currentLocals: ValueType[];
  /**
   * Active label names, outermost first. Block / loop / labeled-if push;
   * `br` / `br_if` / `br_table` resolve a depth by indexing from the end.
   * binaryen-ts identifies break targets by string name, while wabt-ts uses
   * depths — this stack bridges the two.
   */
  labelStack: string[];
  /** Monotonic counter for synthetic label names on anonymous blocks. */
  nextLabelId: { value: number };
}

function makeRootCtx(module: WabtModule): BridgeCtx {
  const funcNames: string[] = [];
  const funcSigs: FuncSignature[] = [];
  const globalNames: string[] = [];
  const globalTypes: ValueType[] = [];
  const tableNames: string[] = [];
  const memoryNames: string[] = [];
  const tagNames: string[] = [];
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Func) {
      funcNames.push(imp.func.name);
      funcSigs.push(imp.func.sig);
    } else if (imp.kind === ExternalKind.Global) {
      globalNames.push(imp.global.name);
      globalTypes.push(imp.global.type);
    } else if (imp.kind === ExternalKind.Table) {
      tableNames.push(imp.table.name);
    } else if (imp.kind === ExternalKind.Memory) {
      memoryNames.push(imp.memory.name);
    } else if (imp.kind === ExternalKind.Tag) {
      tagNames.push(imp.tag.name);
    }
  }
  for (const f of module.funcs) {
    funcNames.push(f.name);
    funcSigs.push(f.sig);
  }
  for (const g of module.globals) {
    globalNames.push(g.name);
    globalTypes.push(g.type);
  }
  for (const t of module.tables) tableNames.push(t.name);
  for (const m of module.memories) memoryNames.push(m.name);
  for (const tag of module.tags) tagNames.push(tag.name);

  // binaryen-ts identifies items by string name across the whole module, so
  // any anonymous wabt item (empty `name` string) needs a synthetic one
  // before we call addFunction / addTable / addExport. The synthetic name
  // is generated once per item and reused everywhere — addImport, the
  // defined-item builder, and cross-references like exports + call.
  synthesizeAnonymousNames(funcNames, '$F');
  synthesizeAnonymousNames(globalNames, '$G');
  synthesizeAnonymousNames(tableNames, '$T');
  synthesizeAnonymousNames(memoryNames, '$M');
  synthesizeAnonymousNames(tagNames, '$E');

  return {
    funcNames,
    funcSigs,
    globalNames,
    globalTypes,
    tableNames,
    memoryNames,
    tagNames,
    heapTypeIdx: {},
    types: module.types,
    currentParams: [],
    currentLocals: [],
    labelStack: [],
    nextLabelId: { value: 0 },
  };
}

function synthesizeAnonymousNames(names: string[], prefix: string): void {
  const used = new Set(names);
  for (let i = 0; i < names.length; i++) {
    if (names[i] === '') {
      let n = `${prefix}${i}`;
      while (used.has(n)) n = `${prefix}${i}_${Math.random().toString(36).slice(2, 6)}`;
      names[i] = n;
      used.add(n);
    }
  }
}

/**
 * Placeholder frame for an `if`.
 *
 * An `if` is a branch target in wasm whether or not it carries a label, so it
 * must occupy a slot on `labelStack` or every depth measured inside it is
 * wrong. binaryen-ts's `makeIf` has no label slot, so nothing can branch TO
 * it — a target landing on this frame fails loudly in `resolveLabel` instead
 * of silently resolving to the enclosing block. Cannot collide with a real
 * label: those always begin with `$`.
 */
const IF_FRAME = '<if-frame>';

function resolveLabel(ctx: BridgeCtx, v: Var): string {
  // After resolveNames, br targets are depth indices into the label stack.
  // Name-bearing targets are resolved here too, in case the caller skipped
  // resolveNames.
  if (v.kind === 'name') {
    for (let i = ctx.labelStack.length - 1; i >= 0; i--) {
      if (ctx.labelStack[i] === v.name) return v.name;
    }
    throw new Error(`Bridge: label "${v.name}" not in scope`);
  }
  const idx = ctx.labelStack.length - 1 - v.value;
  if (idx < 0 || idx >= ctx.labelStack.length) {
    throw new Error(
      `Bridge: br depth ${v.value} out of range (stack size ${ctx.labelStack.length})`,
    );
  }
  const name = ctx.labelStack[idx]!;
  if (name === IF_FRAME) {
    // Reachable only for a branch whose target IS an `if`. binaryen-ts cannot
    // express it (no label slot on makeIf), and the alternative — resolving to
    // whatever block encloses the if — is a valid module that computes
    // something else. Fail loudly.
    throw new Error(
      'Bridge: br to an `if` label is not supported (binaryen-ts makeIf has no label slot)',
    );
  }
  return name;
}

/** Resolve a block/loop/if label, generating a synthetic name if empty. */
function nameForLabel(ctx: BridgeCtx, label: string): string {
  if (label !== '') return label;
  const n = `$L${ctx.nextLabelId.value++}`;
  return n;
}

/** Map a wabt BlockType to a binaryen-ts result Type. */
function bridgeBlockType(bt: BlockType, ctx: BridgeCtx): BType {
  switch (bt.kind) {
    case 'void':
      return None;
    case 'value':
      // T13.50: precise, not coarsening — a block result of `(ref $T)` reaching
      // binaryen as `structref` mismatches every use that kept the precise type.
      return wabtTypeToValueType(bt.type, ctx);
    case 'func_type': {
      // This used to throw "multi-value blocks not yet supported" for EVERY
      // func_type blocktype, and the message was wrong about why. A block whose
      // result is a typed reference cannot use the `value` form at all — wabt's
      // `value` kind holds a numeric `Type`, which has no room for `(ref $T)` —
      // so such a block is spelled as a type index even though it returns ONE
      // value. Refusing all of them made every `br_on_cast`-shaped block
      // unbridgeable, which looked like a br_on_cast gap and was not.
      //
      // Genuine multi-value (params, or more than one result) is still refused,
      // now saying so accurately.
      const entry = ctx.types[bt.typeIdx];
      if (entry === undefined || entry.kind !== 'func') {
        throw new Error(`Bridge: block type index ${bt.typeIdx} is not a func type`);
      }
      const { params, results } = entry.sig;
      if (params.length > 0 || results.length > 1) {
        throw new Error(
          `Bridge: multi-value block (${params.length} params, ${results.length} results) not yet supported`,
        );
      }
      return results.length === 0 ? None : wabtTypeToValueType(results[0]!, ctx);
    }
  }
}

function resolveVarName(v: Var, names: ReadonlyArray<string>): string {
  if (v.kind === 'name') return v.name;
  const n = names[v.value];
  if (n === undefined || n === '') {
    throw new Error(`Bridge: no name for index ${v.value}; binaryen-ts needs string names`);
  }
  return n;
}

/**
 * Unwrap an index-kind {@link Var} to its numeric value. Name-kind vars
 * indicate a `resolveNames` step was skipped before bridging; throw rather
 * than silently emit index 0 (the historical writeVar fallback that hid
 * Bug G for so long).
 */
function varIdx(v: Var): number {
  if (v.kind === 'name') {
    throw new Error(
      `Bridge: var "${v.name}" not resolved — run resolveNames before bridgeToBinaryen`,
    );
  }
  return v.value;
}

/**
 * Resolve a wabt type-section index to a binaryen-ts heap-type index.
 * The two index spaces diverge — wabt includes `func` entries, binaryen-ts
 * only assigns heap-type indices to struct/array. The mapping is populated
 * up-front by {@link bridgeToBinaryen} from `module.types`.
 */
function resolveHeapTypeIdx(typeVar: Var, ctx: BridgeCtx): number {
  const wabtIdx = varIdx(typeVar);
  const heapIdx = ctx.heapTypeIdx[wabtIdx];
  if (heapIdx === undefined) {
    throw new Error(
      `Bridge: type index ${wabtIdx} is not a heap type (must be struct or array)`,
    );
  }
  return heapIdx;
}

/**
 * Look up the binaryen-ts ValType to return from `struct.get $type $field`.
 * Packed i8/i16 fields stack-promote to i32; everything else passes through.
 */
function lookupStructFieldType(typeVar: Var, fieldVar: Var, ctx: BridgeCtx): ValType {
  const wabtIdx = varIdx(typeVar);
  const fieldIdx = varIdx(fieldVar);
  const entry = ctx.types[wabtIdx];
  if (entry === undefined || entry.kind !== 'struct') {
    throw new Error(`Bridge: type ${wabtIdx} is not a struct`);
  }
  const field = entry.fields[fieldIdx];
  if (field === undefined) {
    throw new Error(`Bridge: field ${fieldIdx} out of range for struct type ${wabtIdx}`);
  }
  // Packed types promote to i32 on the stack.
  if (field.type === Type.I8 || field.type === Type.I16) return ValType.I32;
  return wabtTypeToValType(field.type);
}

/**
 * Map a struct/array field type to a binaryen-ts StorageType for use in
 * `addHeapType`. Packed i8/i16 are encoded as their own storage variants;
 * other types map to their ValType counterparts.
 */
function wabtFieldTypeToValType(tIn: ValueType): ValType | 'i8' | 'i16' {
  const t = coarsenValueType(tIn);
  if (t === Type.I8) return 'i8';
  if (t === Type.I16) return 'i16';
  return wabtTypeToValType(t);
}

/**
 * The signature a `call_indirect` calls through.
 *
 * 🔧 wabt-ts leaves the node's own `sig` EMPTY when the call names a type
 * (`(call_indirect (type $t) …)`, `typeUse: 'resolved'`): the signature lives at
 * the type, its validator looks it up at the use site, and its binary writer
 * writes the reference as written. Reading `ci.sig` alone therefore built a
 * call with no parameters, and the operands it should have consumed were left
 * on the stack — every one of the 20 corpus modules the bridge gate could not
 * round-trip (C10a). An INLINE signature is on the node, and wins; the lookup
 * is the fallback (`tests/bridge/call_indirect_type_ref.test.ts`).
 */
function callIndirectSig(ci: CallIndirectExpr, ctx: BridgeCtx): FuncSignature {
  if (ci.sig.params.length > 0 || ci.sig.results.length > 0) return ci.sig;
  const idx = varIdx(ci.typeVar);
  const entry = ctx.types[idx];
  if (entry === undefined) {
    throw new Error(`Bridge: call_indirect names type ${idx}, which the module does not define`);
  }
  if (entry.kind !== 'func') {
    throw new Error(
      `Bridge: call_indirect names type ${idx}, which is a ${entry.kind}, not a func`,
    );
  }
  return entry.sig;
}

/**
 * Look up the binaryen-ts ValType to return from `array.get $type`. Packed
 * i8/i16 element types stack-promote to i32; everything else passes through.
 */
function lookupArrayElementType(typeVar: Var, ctx: BridgeCtx): ValType {
  const wabtIdx = varIdx(typeVar);
  const entry = ctx.types[wabtIdx];
  if (entry === undefined || entry.kind !== 'array') {
    throw new Error(`Bridge: type ${wabtIdx} is not an array`);
  }
  if (entry.field.type === Type.I8 || entry.field.type === Type.I16) return ValType.I32;
  return wabtTypeToValType(entry.field.type);
}

/**
 * Map a wabt {@link ValueType} onto binaryen-ts's, KEEPING a concrete
 * `(ref $T)` concrete.
 *
 * INTENT: this is the precise counterpart of {@link wabtTypeToValType}, which
 * coarsens. Coarsening was correct while binaryen-ts's `ValType` was flat and
 * a typed reference had nowhere to go. Since 1.5.0 their `ValueType` is
 * `ValType | RefType`, and their encoder REQUIRES the precision:
 * `gcFuncTypeIndex` looks for a declared func heap type whose params and
 * results match EXACTLY, so a signature coarsened to `structref` matches
 * nothing and throws `unresolved GC function type` for every GC module.
 *
 * Use this wherever a TYPE crosses into binaryen-ts. `wabtTypeToValType`
 * survives only for the few places that genuinely want the abstract type.
 */
function wabtTypeToValueType(t: ValueType, ctx: BridgeCtx): BValueType {
  if (isRefValueType(t)) {
    return { heapType: heapTypeForBridge(t.heapType, ctx), nullable: t.nullable };
  }
  return wabtTypeToValType(t);
}

/**
 * Map a wabt {@link HeapTypeRef} onto binaryen-ts's {@link HeapType}.
 *
 * The abstract arm passes straight through — both sides spell the twelve
 * abstract heap types identically — and a defined type resolves through
 * {@link BridgeCtx.heapTypeIdx}, the same mapping struct/array operations use.
 * An unresolved `$T` throws, matching `varIdx`'s fail-loud policy.
 */
function heapTypeForBridge(h: HeapTypeRef, ctx: BridgeCtx): HeapType {
  // The abstract arm's keyword IS an `AbstractHeapType` value — both sides
  // spell the same twelve strings, and this assignment is what checks it.
  //
  // This was a ten-case switch translating one vocabulary into the other, and
  // it was silently missing `exn` and `noexn`: those fell into the default and
  // threw "not resolved" for a heap type that was perfectly resolved. A
  // hand-written mapping between two enumerations is a place for exactly that
  // kind of gap, which is why deleting it is worth more than its length.
  // Since S6 step 5 stage V2 the two sides hold the SAME type, so an abstract
  // heap type passes through unchanged.
  if (h.kind === 'abstract') return h;
  if (h.kind === 'name') {
    throw new Error(
      `Bridge: heap type "$${h.name}" is not resolved — run resolveNames first`,
    );
  }
  // Index form — user-defined heap type; map through the up-front
  // addHeapType registration in BridgeCtx.heapTypeIdx.
  return varIndex(resolveHeapTypeIdx(h, ctx));
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function bridgeImport(
  b: ModuleBuilder,
  imp: WabtImport,
  internalName: string,
  ctx: BridgeCtx,
): void {
  switch (imp.kind) {
    case ExternalKind.Func:
      b.addFunctionImport(
        internalName,
        imp.module,
        imp.field,
        // T13.50: precise, not coarsening — see bridgeTag. An IMPORTED function's
        // signature reaches the encoder the same way a declared one does.
        imp.func.sig.params.map((t) => wabtTypeToValueType(t, ctx)),
        imp.func.sig.results.map((t) => wabtTypeToValueType(t, ctx)),
      );
      return;
    case ExternalKind.Global:
      b.addGlobalImport(
        internalName,
        imp.module,
        imp.field,
        // T13.50: precise, like declared globals. addGlobalImport takes a
        // ValueType, so an imported `(ref null $T)` coarsened to structref
        // mismatches every use that kept the precise type.
        wabtTypeToValueType(imp.global.type, ctx),
        imp.global.mutable,
      );
      return;
    case ExternalKind.Memory:
      b.addMemoryImport(
        internalName,
        imp.module,
        imp.field,
        limitToNumber(imp.memory.limits.initial, 'memory initial'),
        imp.memory.limits.max === undefined
          ? null
          : limitToNumber(imp.memory.limits.max, 'memory maximum'),
        imp.memory.limits.isShared,
        imp.memory.limits.is64,
      );
      return;
    case ExternalKind.Table:
      b.addTableImport(
        internalName,
        imp.module,
        imp.field,
        wabtTypeToValType(imp.table.elemType),
        limitToNumber(imp.table.limits.initial, 'table initial'),
        imp.table.limits.max === undefined
          ? null
          : limitToNumber(imp.table.limits.max, 'table maximum'),
      );
      return;
    case ExternalKind.Tag:
      // binaryen-ts has no dedicated `addTagImport` factory in v1.0.9. Tag
      // imports are uncommon outside wasic-style modules; surface a clear
      // error rather than silently dropping them.
      throw new Error(
        'Bridge: tag imports not yet supported ' +
          '(binaryen-ts v1.0.9 has no addTagImport factory)',
      );
  }
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

function bridgeGlobal(b: ModuleBuilder, g: WabtGlobal, ctx: BridgeCtx, name: string): void {
  if (g.init.length !== 1) {
    throw new Error(`Bridge: global ${name} has ${g.init.length} init exprs; expected 1`);
  }
  // T13.50: precise, not coarsening. A global declared `(ref null $T)` and
  // coarsened to `structref` mismatches every use that kept the precise type.
  b.addGlobal(name, wabtTypeToValueType(g.type, ctx), g.mutable, bridgeExpr(g.init[0]!, ctx));
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

function bridgeFunc(b: ModuleBuilder, f: WabtFunc, baseCtx: BridgeCtx, name: string): void {
  // Flatten localDecls (each is `{ type, count }`) into per-slot arrays for
  // both wabt-side type lookup (local.get → operand type) and the binaryen-ts
  // Local[] surface.
  const locals: ValueType[] = [];
  const binaryenLocals: Local[] = [];
  for (const decl of f.localDecls) {
    for (let i = 0; i < decl.count; i++) {
      locals.push(decl.type);
      // T13.50: precise. `Local.type` is a ValueType, and the params/results
      // alongside are already precise — a local coarsened to structref makes
      // any struct.get/array.get through it a type mismatch.
      // baseCtx, not ctx: this loop builds the `locals` array that ctx is
      // constructed FROM, so ctx does not exist yet. The converter needs only
      // the heap-type index map, which baseCtx already carries.
      binaryenLocals.push({ type: wabtTypeToValueType(decl.type, baseCtx) });
    }
  }

  const ctx: BridgeCtx = {
    ...baseCtx,
    currentParams: f.sig.params,
    currentLocals: locals,
  };

  const body = bridgeFuncBody(f.body, ctx);

  b.addFunction(
    name,
    f.sig.params.map((t) => wabtTypeToValueType(t, ctx)),
    f.sig.results.map((t) => wabtTypeToValueType(t, ctx)),
    body,
    binaryenLocals,
  );
}

/**
 * A wabt-ts instruction list as the binaryen-ts region it is. Both sides hold a
 * region as a list now, so this is a map, not the one-or-wrapper-block choice
 * it used to be at every region.
 */
function bridgeRegion(body: Expr[], ctx: BridgeCtx): RegionExpr {
  return makeRegion(body.map((e) => bridgeExpr(e, ctx)));
}

function bridgeFuncBody(body: Expr[], ctx: BridgeCtx): RegionExpr {
  return bridgeRegion(body, ctx);
}

// ---------------------------------------------------------------------------
// Expressions (post-order recursion)
// ---------------------------------------------------------------------------

/**
 * The nullness half of `br_on`.
 *
 * Split out because the two halves need different things: the cast pair carries
 * `from`/`to` heap types, the null pair carries none. One IR node, two shapes
 * behind the sub-op.
 */
function bridgeBrOnNull(bn: BrOnExpr, ctx: BridgeCtx): Expression {
  if (bn.values.length > 0) {
    // binaryen-ts's BrOn carries only the tested reference, with no slot for
    // additional branch operands. Refused rather than silently dropped.
    throw new Error(
      `Bridge: ${bn.op} with ${bn.values.length} carried value(s) not yet supported`,
    );
  }
  const ref = bridgeExpr(bn.ref, ctx);
  // Same convention as the cast forms: the node carries the operand's type.
  return makeBrOn(
    bn.op === 'br_on_null' ? BrOnOp.Null : BrOnOp.NonNull,
    resolveLabel(ctx, bn.target),
    ref,
    typeOf(ref),
  );
}

function bridgeExpr(e: Expr, ctx: BridgeCtx): Expression {
  switch (e.kind) {
    // --- Leaves -----------------------------------------------------------
    case 'const':
      return bridgeConst((e as ConstExpr).value);
    case 'nop':
      return makeNop();
    case 'pop':
      // The two IRs' shared mechanism, formerly under two names: wabt-ts's
      // placeholder and binaryen-ts's Pop. Neither is emitted.
      return makePop(ValType.I32);
    case 'unreachable':
      return makeUnreachable();

    // --- Locals / globals --------------------------------------------------
    case 'local.get': {
      const lg = e as LocalGetExpr;
      const idx = requireIndex(lg.var, 'local.get');
      return makeLocalGet(varIndex(idx), wabtTypeToValType(localType(ctx, idx)));
    }
    case 'local.set': {
      const ls = e as LocalSetExpr;
      const idx = requireIndex(ls.var, 'local.set');
      return makeLocalSet(varIndex(idx), bridgeExpr(ls.value, ctx));
    }
    case 'local.tee': {
      const lt = e as LocalTeeExpr;
      const idx = requireIndex(lt.var, 'local.tee');
      return makeLocalTee(
        varIndex(idx),
        bridgeExpr(lt.value, ctx),
        wabtTypeToValType(localType(ctx, idx)),
      );
    }
    case 'global.get': {
      const gg = e as GlobalGetExpr;
      const idx = gg.var.kind === 'index' ? gg.var.value : ctx.globalNames.indexOf(gg.var.name);
      const t = ctx.globalTypes[idx];
      if (t === undefined) {
        throw new Error(
          `Bridge: global.get references unknown global (var=${JSON.stringify(gg.var)})`,
        );
      }
      return makeGlobalGet(varName(resolveVarName(gg.var, ctx.globalNames)), wabtTypeToValType(t));
    }
    case 'global.set': {
      const gs = e as GlobalSetExpr;
      const name = resolveVarName(gs.var, ctx.globalNames);
      return makeGlobalSet(varName(name), bridgeExpr(gs.value, ctx));
    }

    // --- Arithmetic / compare / convert -----------------------------------
    case 'unary': {
      const u = e as UnaryExpr;
      return makeUnary(u.opcode, bridgeExpr(u.value, ctx));
    }
    case 'binary': {
      const be = e as BinaryExpr;
      return makeBinary(
        be.opcode,
        bridgeExpr(be.left, ctx),
        bridgeExpr(be.right, ctx),
      );
    }

    // --- Stack / value flow -----------------------------------------------
    case 'drop': {
      const d = e as DropExpr;
      return makeDrop(bridgeExpr(d.value, ctx));
    }
    case 'return': {
      const r = e as ReturnExpr;
      // Both sides hold a `values` list now (S6 decision 6A): no packing.
      return makeReturn(bridgeValues(r.values, ctx));
    }

    // --- Block-like -------------------------------------------------------
    case 'block': {
      const blk = e as BlockExpr;
      const name = nameForLabel(ctx, blk.label);
      ctx.labelStack.push(name);
      try {
        const children = blk.body.map((c) => bridgeExpr(c, ctx));
        // makeBlock infers type from the last child. For early-exit blocks
        // (last child is br / return / unreachable) that comes out as
        // "unreachable", which loses the block's declared signature.
        // Override with the declared blockType.
        return withDeclaredType(makeBlock(children, name), bridgeBlockType(blk.blockType, ctx));
      } finally {
        ctx.labelStack.pop();
      }
    }
    case 'loop': {
      const lp = e as LoopExpr;
      const name = nameForLabel(ctx, lp.label);
      const resultType = bridgeBlockType(lp.blockType, ctx);
      ctx.labelStack.push(name);
      try {
        return makeLoop(name, bridgeRegion(lp.body, ctx), resultType);
      } finally {
        ctx.labelStack.pop();
      }
    }
    case 'if': {
      const ife = e as IfExpr;
      // 🔧 A labeled `if` used to be REJECTED, on the grounds that "binaryen-ts's
      // makeIf has no label slot" and a `br` targeting it would silently lose
      // the name. `IfExpr.name` exists — the encoder pushes it onto the label
      // stack as the if's branch target — so the rejection was stale, and it was
      // the single reason this route could not read LINEAR WAT: our writer emits
      // labeled ifs, so 417 of 421 modules were refused here.
      //
      // ⚠️ Third stale "not yet supported" in this file, after tag exports and
      // multi-value return. Each was a claim about ANOTHER component's state,
      // and nothing rechecks such a claim when that component moves. A blocker
      // naming a version — "binaryen-ts v1.0.9 has no…" — is a dated assertion,
      // not an invariant.
      const ifName = ife.label === '' ? null : nameForLabel(ctx, ife.label);
      // The condition is evaluated BEFORE the if is entered, so it is bridged
      // outside the frame: a `br` inside the condition targets the enclosing
      // scope, not this `if`.
      const condition = bridgeExpr(ife.condition, ctx);
      // An `if` occupies a branch-target depth even with no label. Omitting
      // this frame made every `br` inside an if resolve ONE FRAME TOO SHALLOW:
      // `br 0` (branch out of the if) silently retargeted the enclosing block
      // and produced a valid module with a different answer, and `br 1`
      // (branch past the if) died with a bogus "depth out of range". Same
      // class as T13.22's catch scope — bridge label bookkeeping diverging
      // from `resolveNames`, which does push a frame here.
      ctx.labelStack.push(ifName ?? IF_FRAME);
      try {
        const ifTrue = bridgeRegion(ife.ifTrue, ctx);
        // wabt-ts holds an absent else and an empty one alike (`ifFalse: []`).
        const ifFalse = ife.ifFalse.length === 0 ? null : bridgeRegion(ife.ifFalse, ctx);
        const built = makeIf(condition, ifTrue, ifFalse);
        return withDeclaredType(
          ifName === null ? built : { ...built, name: ifName },
          bridgeBlockType(ife.blockType, ctx),
        );
      } finally {
        ctx.labelStack.pop();
      }
    }

    // --- Branches ---------------------------------------------------------
    case 'br': {
      const br = e as BrExpr;
      const target = resolveLabel(ctx, br.target);
      return makeBreak(
        target,
        br.condition !== undefined ? bridgeExpr(br.condition, ctx) : null,
        bridgeValues(br.values, ctx),
      );
    }
    case 'br_table': {
      const brT = e as BrTableExpr;
      const targets = brT.targets.map((t) => resolveLabel(ctx, t));
      const defaultTarget = resolveLabel(ctx, brT.defaultTarget);
      // 🔧 Passed `null` for the values, DROPPING `brT.values` — wabt-ts holds a
      // folded `(br_table $a $b (i32.const 7) (local.get 0))`'s carried value
      // there. The same drop-at-packing class as every other branch value bug;
      // found when S6 decision 6A gave `makeSwitch` a list to fill.
      return makeSwitch(
        targets,
        defaultTarget,
        bridgeExpr(brT.value, ctx),
        bridgeValues(brT.values, ctx),
      );
    }

    // --- Calls ------------------------------------------------------------
    case 'call': {
      const c = e as CallExpr;
      const idx = c.func.kind === 'index' ? c.func.value : ctx.funcNames.indexOf(c.func.name);
      const sig = ctx.funcSigs[idx];
      const target = resolveVarName(c.func, ctx.funcNames);
      if (sig === undefined) {
        throw new Error(`Bridge: call references unknown function "${target}"`);
      }
      return makeCall(
        varName(target),
        c.operands.map((a) => bridgeExpr(a, ctx)),
        resultTypeForCall(sig),
      );
    }
    case 'call_indirect': {
      const ci = e as CallIndirectExpr;
      const tableName = resolveVarName(ci.table, ctx.tableNames);
      const target = bridgeExpr(ci.callee, ctx);
      const operands = ci.operands.map((a) => bridgeExpr(a, ctx));
      // Both IRs carry the signature as one `sig` now; only its value types
      // differ between the two type systems. Multi-result calls are refused.
      const sig = callIndirectSig(ci, ctx);
      if (sig.results.length > 1) {
        throw new Error('Bridge: multi-value call_indirect not yet supported');
      }
      return makeCallIndirect(varName(tableName), target, operands, {
        params: sig.params.map(wabtTypeToValType),
        results: sig.results.map(wabtTypeToValType),
      });
    }

    // --- Select -----------------------------------------------------------
    case 'select': {
      const s = e as SelectExpr;
      // 🔧 The declared type was DROPPED here, so a `(select (result (ref null
      // $t)) …)` crossing the bridge fell back to its `ifTrue` arm's type.
      const declared = s.resultType[0];
      return makeSelect(
        bridgeExpr(s.val1, ctx),
        bridgeExpr(s.val2, ctx),
        bridgeExpr(s.condition, ctx),
        declared === undefined ? null : wabtTypeToValueType(declared, ctx),
      );
    }

    // --- Memory load / store ---------------------------------------------
    case 'load': {
      const ld = e as LoadExpr;
      requireDefaultMemory(ld.memidx, 'load');
      // The WAT lexer maps every `v128.load*_splat` / `v128.load*_zero` /
      // `v128.load*x*_s|u` / plain `v128.load` to TokenType.Load, so a
      // parser-sourced module sends them all through here as LoadExpr.
      // (The binary reader's IR path uses LoadSplatExpr / LoadZeroExpr —
      // those have their own cases below.) Route SIMD-prefix opcodes to
      // makeSIMDLoad; everything else — plain `v128.load` included — is a
      // plain Load, and both IRs now hold the same opcode, so it passes through.
      const simdOp = simdLoadOpForOpcode(ld.opcode);
      if (simdOp !== null) {
        return makeSIMDLoad(
          simdOp,
          bridgeExpr(ld.address, ctx),
          ld.offset,
          alignBytesToExponent(ld.align, 'load'),
        );
      }
      return makeLoad(
        ld.opcode,
        ld.offset,
        alignBytesToExponent(ld.align, 'load'),
        bridgeExpr(ld.address, ctx),
      );
    }
    case 'simd.load': {
      // Binary-reader IR path; the WAT-parser path produces LoadExpr.
      const ls = e as LoadSplatExpr;
      requireDefaultMemory(ls.memidx, 'simd.load');
      return makeSIMDLoad(
        ls.opcode,
        bridgeExpr(ls.address, ctx),
        ls.offset,
        alignBytesToExponent(ls.align, 'simd.load'),
      );
    }
    case 'simd.load_store_lane': {
      const sll = e as SimdLoadLaneExpr;
      requireDefaultMemory(sll.memidx, 'simd.load_store_lane');
      return makeSIMDLoadStoreLane(
        sll.opcode,
        bridgeExpr(sll.address, ctx),
        bridgeExpr(sll.vec, ctx),
        sll.offset,
        alignBytesToExponent(sll.align, 'simd.load_store_lane'),
        sll.lane,
      );
    }
    case 'store': {
      const st = e as StoreExpr;
      requireDefaultMemory(st.memidx, 'store');
      return makeStore(
        st.opcode,
        st.offset,
        alignBytesToExponent(st.align, 'store'),
        bridgeExpr(st.address, ctx),
        bridgeExpr(st.value, ctx),
      );
    }
    case 'memory.size': {
      const ms = e as MemorySizeExpr;
      requireDefaultMemory(ms.memidx, 'memory.size');
      return makeMemorySize();
    }
    case 'memory.grow': {
      const mg = e as MemoryGrowExpr;
      requireDefaultMemory(mg.memidx, 'memory.grow');
      return makeMemoryGrow(bridgeExpr(mg.delta, ctx));
    }

    // --- Reference types (Tier C) ----------------------------------------
    case 'ref.null': {
      const rn = e as RefNullExpr;
      return makeRefNull(refTypeVarToValType(rn.refType, ctx));
    }
    case 'ref.func': {
      const rf = e as RefFuncExpr;
      return makeRefFunc(varName(resolveVarName(rf.func, ctx.funcNames)), ValType.FuncRef);
    }
    case 'ref.is_null': {
      const rin = e as RefIsNullExpr;
      return makeRefIsNull(bridgeExpr(rin.value, ctx));
    }
    case 'ref.as':
      // binaryen-ts v1.0.9 has no makeRefAsNonNull factory; emit a clear
      // error rather than silently producing wrong output. Revisit when
      // binaryen-ts gains the factory.
      throw new Error('Bridge: ref.as_non_null not supported (binaryen-ts has no factory)');

    // --- GC Tier 1: i31 + ref.eq ----------------------------------------
    case 'ref.eq': {
      const re = e as RefEqExpr;
      return makeRefEq(bridgeExpr(re.left, ctx), bridgeExpr(re.right, ctx));
    }
    case 'any.convert_extern':
    case 'extern.convert_any': {
      // Both IRs model the pair as one node with the direction in the kind.
      const ce = e as ExternConvertExpr;
      return makeExternConvert(
        ce.kind === 'any.convert_extern'
          ? ExpressionKind.AnyConvertExtern
          : ExpressionKind.ExternConvertAny,
        bridgeExpr(ce.value, ctx),
      );
    }
    case 'ref.i31': {
      const ri = e as RefI31Expr;
      // binaryen-ts's makeRefI31 takes a `resultType` argument; i31ref is
      // the only valid result type for ref.i31.
      return makeRefI31(bridgeExpr(ri.value, ctx), ValType.I31Ref);
    }
    case 'i31.get': {
      const ig = e as I31GetExpr;
      return makeI31Get(bridgeExpr(ig.i31, ctx), ig.signed);
    }

    // --- GC Tier 2: struct -------------------------------------------------
    case 'struct.new': {
      const sn = e as StructNewExpr;
      const heapIdx = resolveHeapTypeIdx(sn.typeVar, ctx);
      // One kind, two forms: the default takes no field values at all.
      if (sn.defaultInit) {
        return makeStructNewDefault(varIndex(heapIdx), {
          heapType: varIndex(heapIdx),
          nullable: false,
        });
      }
      return makeStructNew(varIndex(heapIdx), sn.operands.map((o) => bridgeExpr(o, ctx)), {
        heapType: varIndex(heapIdx),
        nullable: false,
      });
    }
    case 'struct.get': {
      const sg = e as StructGetExpr;
      const heapIdx = resolveHeapTypeIdx(sg.typeVar, ctx);
      const fieldType = lookupStructFieldType(sg.typeVar, sg.fieldVar, ctx);
      return makeStructGet(
        varIndex(heapIdx),
        varIndex(varIdx(sg.fieldVar)),
        bridgeExpr(sg.ref, ctx),
        fieldType,
        sg.signed === true,
      );
    }
    case 'struct.set': {
      const ss = e as StructSetExpr;
      const heapIdx = resolveHeapTypeIdx(ss.typeVar, ctx);
      return makeStructSet(
        varIndex(heapIdx),
        varIndex(varIdx(ss.fieldVar)),
        bridgeExpr(ss.ref, ctx),
        bridgeExpr(ss.value, ctx),
      );
    }

    // --- GC Tier 3: array.* ------------------------------------------------
    case 'array.new': {
      const an = e as ArrayNewExpr;
      const heapIdx = resolveHeapTypeIdx(an.typeVar, ctx);
      // An absent initialiser IS the default form.
      if (an.init === undefined) {
        return makeArrayNewDefault(varIndex(heapIdx), bridgeExpr(an.length, ctx), {
          heapType: varIndex(heapIdx),
          nullable: false,
        });
      }
      return makeArrayNew(varIndex(heapIdx), bridgeExpr(an.init, ctx), bridgeExpr(an.length, ctx), {
        heapType: varIndex(heapIdx),
        nullable: false,
      });
    }
    case 'array.new_fixed': {
      const anf = e as ArrayNewFixedExpr;
      const heapIdx = resolveHeapTypeIdx(anf.typeVar, ctx);
      return makeArrayNewFixed(varIndex(heapIdx), anf.operands.map((o) => bridgeExpr(o, ctx)), {
        heapType: varIndex(heapIdx),
        nullable: false,
      });
    }
    case 'array.new_data': {
      const and2 = e as ArrayNewDataExpr;
      const heapIdx = resolveHeapTypeIdx(and2.typeVar, ctx);
      return makeArrayNewData(
        varIndex(heapIdx),
        varIndex(varIdx(and2.dataVar)),
        bridgeExpr(and2.offset, ctx),
        bridgeExpr(and2.length, ctx),
        { heapType: varIndex(heapIdx), nullable: false },
      );
    }
    case 'array.new_elem': {
      const ane = e as ArrayNewElemExpr;
      const heapIdx = resolveHeapTypeIdx(ane.typeVar, ctx);
      return makeArrayNewElem(
        varIndex(heapIdx),
        varIndex(varIdx(ane.elemVar)),
        bridgeExpr(ane.offset, ctx),
        bridgeExpr(ane.length, ctx),
        { heapType: varIndex(heapIdx), nullable: false },
      );
    }
    case 'array.get': {
      const ag = e as ArrayGetExpr;
      const heapIdx = resolveHeapTypeIdx(ag.typeVar, ctx);
      const elementType = lookupArrayElementType(ag.typeVar, ctx);
      return makeArrayGet(
        varIndex(heapIdx),
        bridgeExpr(ag.ref, ctx),
        bridgeExpr(ag.index, ctx),
        elementType,
        ag.signed === true,
      );
    }
    case 'array.set': {
      const as = e as ArraySetExpr;
      const heapIdx = resolveHeapTypeIdx(as.typeVar, ctx);
      return makeArraySet(
        varIndex(heapIdx),
        bridgeExpr(as.ref, ctx),
        bridgeExpr(as.index, ctx),
        bridgeExpr(as.value, ctx),
      );
    }
    case 'array.len': {
      const al = e as ArrayLenExpr;
      return makeArrayLen(bridgeExpr(al.ref, ctx));
    }

    // --- GC Tier 4: ref.test / ref.cast -----------------------------------
    case 'ref.test': {
      const rt = e as RefTestExpr;
      return makeRefTest(bridgeExpr(rt.ref, ctx), heapTypeForBridge(rt.heapType, ctx), rt.nullable);
    }
    case 'ref.cast': {
      const rc = e as RefCastExpr;
      const heap = heapTypeForBridge(rc.heapType, ctx);
      return makeRefCast(
        bridgeExpr(rc.ref, ctx),
        heap,
        rc.nullable,
        { heapType: heap, nullable: rc.nullable },
      );
    }

    // --- Reference branching (T13.51) -------------------------------------
    //
    // binaryen-ts already models all four: `BrOnOp` defines Null, NonNull, Cast
    // and CastFail, `makeBrOn` takes the cast/src heap types, and the encoder and
    // binary reader both handle `BrOn`. Only the translation was missing, which is
    // why these four arrive together — they are one enum's worth of cases, not
    // four features.
    case 'br_on': {
      const bc = e as BrOnExpr;
      if (bc.op === 'br_on_null' || bc.op === 'br_on_non_null') return bridgeBrOnNull(bc, ctx);
      // rt1 is the operand's expected type (src), rt2 the type tested for (cast).
      // The sub-op selects which of the two the branch carries; binaryen encodes
      // that choice in the op, and keeps both types either way.
      const src = heapTypeForBridge(bc.from!.heapType, ctx);
      const cast = heapTypeForBridge(bc.to!.heapType, ctx);
      // The node's `type` is the OPERAND's type, matching what the binary reader
      // produces (`makeBrOn(..., ref.type, ht2, ..., ht1, ...)` in wasm-parser).
      // Computing a fallthrough type here instead produced `type mismatch in
      // br_on_cast` — encode and decode have to agree, and the decoder is the
      // side that already round-trips.
      const ref = bridgeExpr(bc.ref, ctx);
      return makeBrOn(
        bc.op === 'br_on_cast_fail' ? BrOnOp.CastFail : BrOnOp.Cast,
        resolveLabel(ctx, bc.target),
        ref,
        typeOf(ref),
        cast,
        bc.to!.nullable,
        src,
        bc.from!.nullable,
      );
    }

    // --- SIMD (Tier C) ---------------------------------------------------
    //
    // Note: `i*x*.splat` opcodes flow through the `unary` case above —
    // wabt-ts classifies them as UnaryExpr, and the WAT-string opcode name
    // happens to match binaryen-ts's `UnaryOp` enum value directly. Same
    // for SIMD lane-wise arithmetic (`i8x16.add`, `f32x4.mul`, …) via the
    // `binary` case.
    case 'simd.extract': {
      // The kinds carry the distinction now, so the name-based classification
      // this replaced -- and its "missing scalar operand" guard, which existed
      // only because one kind held both forms -- are both gone.
      const se = e as SimdExtractExpr;
      return makeSIMDExtract(se.opcode, bridgeExpr(se.vec, ctx), se.lane);
    }
    case 'simd.replace': {
      const sr = e as SimdReplaceExpr;
      return makeSIMDReplace(
        sr.opcode,
        bridgeExpr(sr.vec, ctx),
        sr.lane,
        bridgeExpr(sr.value, ctx),
      );
    }
    case 'simd.shuffle': {
      const ss = e as SimdShuffleOpExpr;
      return makeSIMDShuffle(
        bridgeExpr(ss.left, ctx),
        bridgeExpr(ss.right, ctx),
        ss.lanes,
      );
    }

    // --- Exception handling (Tier C) -------------------------------------
    case 'throw': {
      const th = e as ThrowExpr;
      return makeThrow(
        varName(resolveVarName(th.tag, ctx.tagNames)),
        th.operands.map((a) => bridgeExpr(a, ctx)),
      );
    }
    case 'throw_ref': {
      const tr = e as ThrowRefExpr;
      return makeThrowRef(bridgeExpr(tr.exnref, ctx));
    }
    case 'try_table': {
      const tt = e as TryTableExpr;
      const name = nameForLabel(ctx, tt.label);
      // INTENT: catch targets resolve in the ENCLOSING scope -- a try_table's
      // own label is NOT in scope for its handlers, so depth 0 names the frame
      // outside it. The clauses are therefore built BEFORE the push, and the
      // body after it. Getting this backwards is T13.22, and it was invisible
      // for four releases because binaryen-ts 1.0.9 counted the try_table
      // frame too, so the two errors cancelled to the right wire depth.
      //
      // binaryen-ts 1.5.0 fixed their half. With the pin there and this line
      // in the old position, a numeric `(catch $e 1)` silently encoded depth 0
      // -- bytes V8 still accepts, naming the wrong handler -- and a named
      // target threw `unresolved branch label`. So this ordering and the pin
      // are ONE change; see T13.22 in cmem/ir-convergence.md § "The bridge and
      // the WAT routes into binaryen-ts".
      const catches: CatchClause[] = tt.catches.map((c) => buildCatchClause(c, ctx));
      ctx.labelStack.push(name);
      try {
        const body = bridgeRegion(tt.body, ctx);
        return withDeclaredType(
          makeTryTable(name, body, catches, bridgeBlockType(tt.blockType, ctx)),
          bridgeBlockType(tt.blockType, ctx),
        );
      } finally {
        ctx.labelStack.pop();
      }
    }

    // --- Bulk memory --------------------------------------------------------
    //
    // binaryen-ts has had `MemoryCopy` and `MemoryFill` all along; the bridge
    // simply never listed them, so 280 of 421 corpus modules could not cross.
    // The multi-memory immediates are refused rather than ignored, because a
    // non-zero memidx silently encoded against memory 0 would touch the wrong
    // memory.
    case 'memory.copy': {
      const mc = e as MemoryCopyExpr;
      requireDefaultMemory(mc.destMemidx, 'memory.copy dest');
      requireDefaultMemory(mc.srcMemidx, 'memory.copy src');
      return makeMemoryCopy(
        bridgeExpr(mc.dest, ctx),
        bridgeExpr(mc.source, ctx),
        bridgeExpr(mc.size, ctx),
      );
    }
    case 'memory.fill': {
      const mf = e as MemoryFillExpr;
      requireDefaultMemory(mf.memidx, 'memory.fill');
      return makeMemoryFill(
        bridgeExpr(mf.dest, ctx),
        bridgeExpr(mf.value, ctx),
        bridgeExpr(mf.size, ctx),
      );
    }

    // --- Exception handling -------------------------------------------------
    //
    // binaryen-ts has had `makeTry` throughout; the bridge simply never listed
    // the kind. A `catch_all` clause has NO tag and is written that way — the
    // field is absent. Two sentinels were tried before that: `$__catch_all`,
    // which can collide with a real tag, and `''`, which the parser and encoder
    // then disagreed about. A value used to mean "no value" invites both.
    case 'try': {
      const tr = e as TryExpr;
      const name = nameForLabel(ctx, tr.label);
      const resultType = bridgeBlockType(tr.blockType, ctx);
      ctx.labelStack.push(name);
      try {
        const body = bridgeRegion(tr.body, ctx);
        // `catch_ref` / `catch_all_ref` used to throw "not yet supported" here,
        // because binaryen-ts's Try had no slot for the flag and dropping it
        // would change what the handler receives. The clause carries `isRef`
        // now and the encoder writes 0x08 / 0x18 for it.
        const catches: TryCatch[] = tr.catches.map((c) => ({
          ...(c.tag === undefined ? {} : { tag: varName(resolveVarName(c.tag, ctx.tagNames)) }),
          isRef: c.isRef,
          body: bridgeRegion(c.body, ctx),
        }));
        const delegateTarget = tr.delegate === undefined ? null : resolveLabel(ctx, tr.delegate);
        return makeTry(name, body, catches, delegateTarget, resultType);
      } finally {
        ctx.labelStack.pop();
      }
    }

    case 'rethrow': {
      // The depth names an enclosing TRY, and binaryen-ts holds that target by
      // name, so it resolves through the same label stack a branch does.
      return makeRethrow(resolveLabel(ctx, (e as RethrowExpr).target));
    }

    default:
      throw new Error(`Bridge: expression kind not yet supported: ${e.kind}`);
  }
}

/** Translate a wabt try_table catch into a binaryen-ts CatchClause. */
function buildCatchClause(
  c: TableCatch,
  ctx: BridgeCtx,
): CatchClause {
  const target = varName(resolveLabel(ctx, c.target));
  // Switching on `kind` narrows the union, so the tagged arms SEE a tag —
  // the `c.tag!` assertions this used to need are gone.
  switch (c.kind) {
    case CatchKind.Catch:
      return { tag: varName(resolveVarName(c.tag, ctx.tagNames)), target, isRef: false };
    case CatchKind.CatchRef:
      return { tag: varName(resolveVarName(c.tag, ctx.tagNames)), target, isRef: true };
    case CatchKind.CatchAll:
      return { target, isRef: false };
    case CatchKind.CatchAllRef:
      return { target, isRef: true };
  }
}

/**
 * Map a wabt-ts `refType: Var` (used by `ref.null`) to a binaryen-ts
 * `ValType`. The WAT parser and binary reader both produce a name-var holding
 * a bare abstract heap-type keyword (`"func"` / `"extern"` / `"any"` / …);
 * index-vars name a user-defined heap type, which the flat `ValType` surface
 * can't express.
 */
function refTypeVarToValType(h: HeapTypeRef, ctx: BridgeCtx): BValueType {
  if (h.kind === 'abstract') {
    const t = heapTypeNameToType(h.name);
    if (t === null) {
      // Not a caller error any more: the arm guarantees a keyword, so a miss
      // means the encoding table is short an entry.
      throw new Error(
        `Bridge: abstract heap type "${h.name}" has no encoding — extend ABSTRACT_HEAP_TYPES`,
      );
    }
    return wabtTypeToValType(t);
  }
  if (h.kind === 'name') {
    throw new Error(
      `Bridge: ref.null with unresolved heap type "$${h.name}" — run resolveNames first`,
    );
  }
  // T13.50b: index-form refType targets a USER-DEFINED heap type. This used to
  // throw "not yet supported", and the reason given was that it "needs the
  // typed-ref IR refactor" — but that refactor is what T13.47 landed. Since
  // binaryen-ts 1.5.0 a `ValueType` is `ValType | RefType`, `makeRefNull` takes a
  // ValueType, and `resolveHeapTypeIdx` already maps a wabt type index onto the
  // registered binaryen heap type. The limitation outlived its cause.
  //
  // `ref.null` is nullable by definition, so nullable is unconditionally true.
  return { heapType: varIndex(resolveHeapTypeIdx(h, ctx)), nullable: true };
}

/**
 * A branch's or return's carried values, element for element — both IRs hold a
 * `values` list since S6 decision 6A, so nothing is packed or unpacked here.
 */
function bridgeValues(values: Expr[], ctx: BridgeCtx): Expression[] {
  return values.map((v) => bridgeExpr(v, ctx));
}

// --- Small helpers used inside bridgeExpr ---

function requireIndex(v: Var, label: string): number {
  if (v.kind !== 'index') {
    throw new Error(`Bridge: ${label} with name var — run resolveNames first`);
  }
  return v.value;
}

function localType(ctx: BridgeCtx, idx: number): Type {
  // The bridge's flat ValType surface cannot carry a concrete typed ref, so
  // coarsen — same loss wabtTypeToValType takes, and only here.
  return coarsenValueType(
    idx < ctx.currentParams.length
      ? ctx.currentParams[idx]!
      : ctx.currentLocals[idx - ctx.currentParams.length]!,
  );
}

/**
 * Override the inferred `type` field on a binaryen-ts block / if expression
 * to match its WAT-declared block signature. binaryen-ts infers the type
 * from the last child, but for early-exit forms (br / return / unreachable
 * as the last child) that loses the declared signature. The encoder writes
 * `e.type` directly into the binary block_type slot, so we have to fix it
 * here before the value escapes the bridge.
 */
function withDeclaredType<T extends { type?: BType }>(expr: T, declared: BType): T {
  return declared === expr.type ? expr : { ...expr, type: declared };
}

/**
 * Map a wabt function signature's results to the `Type` makeCall wants.
 *
 * 🔧 More than one result used to throw. binaryen-ts spells a multi-value type
 * as an ARRAY of value types — that is what `declaredType` builds for a
 * multi-result block, and what the encoder resolves to a type-section index — so
 * the tuple type is simply the mapped list.
 */
function resultTypeForCall(sig: FuncSignature): BType {
  if (sig.results.length === 0) return None;
  if (sig.results.length === 1) return wabtTypeToValType(sig.results[0]!);
  return sig.results.map((r) => wabtTypeToValType(r)) as BType;
}

/** Reject any non-default-memory reference until the bridge handles multi-memory. */
function requireDefaultMemory(memidx: Var, opLabel: string): void {
  if (memidx.kind === 'index' && memidx.value !== 0) {
    throw new Error(`Bridge: ${opLabel} with non-zero memidx (${memidx.value}) not yet supported`);
  }
  if (memidx.kind === 'name') {
    // Name-based references only make sense in multi-memory; treat as unsupported.
    throw new Error(`Bridge: ${opLabel} with named memory not yet supported`);
  }
}

// `bigintOffsetToNumber` stood here, converting wabt-ts's bigint offset into a
// number and throwing above the u32 range — "memory64 not supported yet". Both
// sides carry `bigint` now and the encoder writes a u64 LEB, so the offset
// passes straight through and that limitation is gone.
//
// ⚠️ The mechanical pass first produced `BigInt(bigintOffsetToNumber(off, …))`,
// which type-checks and preserves the exact loss the change existed to remove.
// A wrapper that satisfies the compiler is not evidence that the value survived.

/**
 * Convert wabt-ts's byte-valued alignment into the wasm `memarg.align`
 * exponent that binaryen-ts's encoder writes to the binary (`4` → `2`).
 *
 * wabt-ts's parser used to store `0` for "no explicit align", and this
 * function resolved it to the natural byte count the caller passed. The
 * parser now stores the natural alignment itself, so every producer hands
 * over a real power of two and anything else is a producer bug — thrown,
 * because log2 of it is not an exponent and the optimizer reads the field
 * as a hard constraint.
 */
function alignBytesToExponent(wabtAlign: number, opLabel: string): number {
  // (Math.log2 is exact on powers of two; a bitwise test would wrap past 2^31.)
  const exponent = Math.log2(wabtAlign);
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(`Bridge: ${opLabel} align ${wabtAlign} is not a positive power of two`);
  }
  return exponent;
}

/**
 * Classify a 0xfd-prefixed SIMD load opcode against binaryen-ts's
 * `SIMDLoadOp` enum. Returns `null` for any non-SIMD-load opcode
 * (including plain `v128.load`, which is a regular 16-byte makeLoad).
 *
 * Routing matters because the WAT lexer maps every SIMD load to
 * TokenType.Load — so a parser-sourced module sends splat/zero/extend
 * opcodes through the `load` case as plain `LoadExpr`. Binaryen-ts uses
 * a different factory (`makeSIMDLoad`) for those, so the bridge dispatches
 * here on the opcode byte rather than the IR kind.
 */
function simdLoadOpForOpcode(opcode: number): SIMDLoadOp | null {
  if ((opcode >> 16) !== 0xfd) return null;
  switch (opcode & 0xffff) {
    case 0x01:
      return SIMDLoadOp.Load8x8SVec128;
    case 0x02:
      return SIMDLoadOp.Load8x8UVec128;
    case 0x03:
      return SIMDLoadOp.Load16x4SVec128;
    case 0x04:
      return SIMDLoadOp.Load16x4UVec128;
    case 0x05:
      return SIMDLoadOp.Load32x2SVec128;
    case 0x06:
      return SIMDLoadOp.Load32x2UVec128;
    case 0x07:
      return SIMDLoadOp.Load8SplatVec128;
    case 0x08:
      return SIMDLoadOp.Load16SplatVec128;
    case 0x09:
      return SIMDLoadOp.Load32SplatVec128;
    case 0x0a:
      return SIMDLoadOp.Load64SplatVec128;
    case 0x5c:
      return SIMDLoadOp.Load32ZeroVec128;
    case 0x5d:
      return SIMDLoadOp.Load64ZeroVec128;
    default:
      return null; // includes plain v128.load (0x00) → caller uses makeLoad
  }
}

function bridgeConst(c: Const): Expression {
  switch (c.type) {
    case Type.I32:
      return makeI32Const(c.value);
    case Type.I64:
      return makeI64Const(c.value);
    case Type.F32: {
      // wabt-ts stores f32 as raw uint32 bit pattern; binaryen-ts wants the
      // actual float. Reinterpret via a tiny shared buffer.
      const u32 = new Uint32Array([c.bits >>> 0]);
      const f32 = new Float32Array(u32.buffer);
      return makeF32Const(f32[0]!);
    }
    case Type.F64: {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigUint64(0, c.bits, true);
      return makeF64Const(new Float64Array(buf)[0]!);
    }
    case Type.V128:
      // wabt-ts stores v128 as 16 raw bytes; binaryen-ts wants the same.
      return makeV128Const(c.bytes);
    default:
      throw new Error(
        `Bridge: const type not yet supported: 0x${(c as { type: number }).type.toString(16)}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function bridgeExport(b: ModuleBuilder, exp: WabtExport, ctx: BridgeCtx): void {
  switch (exp.kind) {
    case ExternalKind.Func:
      b.addExport(exp.name, resolveVarName(exp.var, ctx.funcNames), 'function');
      return;
    case ExternalKind.Global:
      b.addExport(exp.name, resolveVarName(exp.var, ctx.globalNames), 'global');
      return;
    case ExternalKind.Memory:
      b.addExport(exp.name, resolveVarName(exp.var, ctx.memoryNames), 'memory');
      return;
    case ExternalKind.Table:
      b.addExport(exp.name, resolveVarName(exp.var, ctx.tableNames), 'table');
      return;
    case ExternalKind.Tag:
      // 🔧 This threw, citing binaryen-ts v1.0.9 having no "tag" export kind.
      // `WasmExport.kind` has included `'tag'` for a long time; the blocker was
      // stale, and the version it named is several releases old. A "not yet
      // supported" note is a claim about ANOTHER component's state, and nothing
      // rechecks it when that component moves.
      b.addExport(exp.name, resolveVarName(exp.var, ctx.tagNames), 'tag');
      return;
  }
}

// ---------------------------------------------------------------------------
// Data segments
// ---------------------------------------------------------------------------

function bridgeDataSegment(
  b: ModuleBuilder,
  seg: WabtModule['dataSegments'][number],
  ctx: BridgeCtx,
): void {
  if (seg.kind === 'passive') {
    b.addPassiveDataSegment(seg.name, seg.data);
    return;
  }
  if (seg.kind === 'declared') {
    // The 'declared' segment kind exists in wabt's IR for symmetry with
    // element segments but is meaningless for data — no data section
    // entry, no offset, no initialization. Skip silently.
    return;
  }
  // Active segment: must have a single-expression constant offset.
  if (seg.offset.length !== 1) {
    throw new Error(
      `Bridge: data segment ${seg.name} has ${seg.offset.length} offset exprs; expected 1`,
    );
  }
  // wabt's IR allows a per-segment memoryVar; binaryen-ts's addDataSegment
  // is single-memory under MVP. Verify the target is memory 0.
  if (seg.memoryVar.kind === 'index' && seg.memoryVar.value !== 0) {
    throw new Error(
      `Bridge: data segment ${seg.name} targets non-zero memory ${seg.memoryVar.value} (multi-memory not yet supported)`,
    );
  }
  b.addDataSegment(seg.name, bridgeExpr(seg.offset[0]!, ctx), seg.data);
}
