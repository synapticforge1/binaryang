/**
 * @module binaryen-ts/binary/wasm-parser
 *
 * WASM binary format parser.
 * Converts a WebAssembly binary (Uint8Array) into a WasmModule IR tree.
 *
 * @license MIT
 */

import { BinaryReader, WasmBinaryError } from './reader.ts';
import { DecodedNames } from './names.ts';
import { heapAbstract, type Var, varIndex, varName } from '../../wabt-ts/ir/ir.ts';
import { type Opcode, OPCODE_V128_LOAD, OPCODE_V128_STORE } from '../../wabt-ts/core/opcode.ts';
import {
  type CustomSection,
  type ElementSegment,
  type ElementSegmentMode,
  type Local,
  ModuleBuilder,
  type WasmFunction,
  type WasmModule,
} from '../ir/module.ts';
import {
  BinaryOp,
  type BlockParams,
  type Expression,
  makeBinary,
  makeBlock,
  makeBreak,
  makeCall,
  makeCallIndirect,
  makeDataDrop,
  makeDrop,
  makeElemDrop,
  makeF32ConstBits,
  makeF64ConstBits,
  makeGlobalGet,
  makeGlobalSet,
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
  makeMemoryInit,
  makeMemorySize,
  makeNop,
  makePop,
  makeQuaternary,
  makeRefAsNonNull,
  makeRefFunc,
  makeRefIsNull,
  makeRefNull,
  makeRegion,
  makeRethrow,
  makeReturn,
  makeSelect,
  makeSIMDExtract,
  makeSIMDLoad,
  makeSIMDLoadStoreLane,
  makeSIMDReplace,
  makeSIMDShuffle,
  makeSIMDTernary,
  makeStore,
  makeSwitch,
  makeTableCopy,
  makeTableFill,
  makeTableGet,
  makeTableGrow,
  makeTableInit,
  makeTableSet,
  makeTableSize,
  makeThrow,
  makeThrowRef,
  makeTry,
  makeTryTable,
  makeUnary,
  makeUnreachable,
  makeV128Const,
  QuaternaryOp,
  type RegionExpr,
  SIMDExtractOp,
  SIMDLoadOp,
  SIMDLoadStoreLaneOp,
  SIMDReplaceOp,
  SIMDTernaryOp,
  type TableCatch,
  typeOf,
  UnaryOp,
} from '../ir/expressions.ts';
import {
  AbstractHeapType,
  type FieldType,
  type HeapType,
  isRefType,
  type RefType,
  type StorageType,
  type TypeDef,
  type ValueType,
} from '../ir/gc-types.ts';
import {
  BrOnOp,
  ExpressionKind,
  makeArrayCopy,
  makeArrayFill,
  makeArrayGet,
  makeArrayInitData,
  makeArrayInitElem,
  makeArrayLen,
  makeArrayNew,
  makeArrayNewData,
  makeArrayNewDefault,
  makeArrayNewElem,
  makeArrayNewFixed,
  makeArraySet,
  makeBrOn,
  makeExternConvert,
  makeI31Get,
  makeRefCast,
  makeRefEq,
  makeRefI31,
  makeRefTest,
  makeStructGet,
  makeStructNew,
  makeStructNewDefault,
  makeStructSet,
} from '../ir/expressions.ts';
import { None, type Type, ValType } from '../ir/types.ts';

// ---------------------------------------------------------------------------
// Section IDs
// ---------------------------------------------------------------------------

const SECTION_CUSTOM = 0;
const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_FUNCTION = 3;
const SECTION_TABLE = 4;
const SECTION_MEMORY = 5;
const SECTION_GLOBAL = 6;
const SECTION_EXPORT = 7;
const SECTION_START = 8;
const SECTION_ELEMENT = 9;
const SECTION_CODE = 10;
const SECTION_DATA = 11;
const SECTION_DATA_COUNT = 12;
const SECTION_TAG = 13;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FuncType {
  params: ValueType[];
  results: ValueType[];
}

interface GlobalInfo {
  type: ValueType;
  mutable: boolean;
}

type ControlFrameKind = 'block' | 'loop' | 'if' | 'else' | 'func' | 'try' | 'catch' | 'try_table';

interface ControlFrame {
  kind: ControlFrameKind;
  label: string;
  resultTypes: (ValType | RefType)[];
  exprs: Expression[];
  ifCondition?: Expression;
  thenExprs?: Expression[];
  // try / catch state
  tryBody?: Expression[];
  /** Tags in arrival order; `undefined` marks a `catch_all`. Zipped with
   *  `catchBodies` into Catch clauses at `end` — they accumulate separately
   *  because the tag arrives at the `catch` opcode and the body after it. */
  catchTags?: (Var | undefined)[];
  catchBodies?: Expression[][];
  delegateTarget?: string | null;
  /**
   * For an `if` with parameters: builds the ELSE arm's starting stack — fresh
   * `Pop`s, or fresh reads of the spill slots when lowering.
   *
   * A function that builds fresh nodes, deliberately not the then-arm's nodes.
   * Both arms need the same seed, and this IR requires every expression node to
   * have exactly one parent — handing the same objects to both arms aliases one
   * object into two tree positions.
   */
  seedElse?: () => Expression[];
  /** The construct's parameters, kept on the node (not lowering). */
  params?: BlockParams;
  /** The type-section index its header NAMED, where one was written (7c). */
  typeIndex?: number;
  /** For a LOOP with parameters, when lowering: the local slots they were spilled into. */
  paramLocals?: number[];
  /**
   * For a LOOP with parameters: the declared type of each — what a branch back
   * to it carries (kept), or what its temps hold (lowering).
   */
  paramTypes?: ValueType[];
  // try_table state
  tryCatches?: TableCatch[];
}

interface TagInfo {
  name: string;
  params: ValueType[];
}

interface DecoderCtx {
  // Index-for-index with the type section. A struct/array entry is `null`:
  // it used to hold a placeholder `() -> ()`, which was indistinguishable from
  // a real one, so a call naming a struct index popped ZERO operands and built
  // a zero-arity call node instead of failing.
  funcTypes: (FuncType | null)[];
  heapTypeDefs: TypeDef[];
  importedFuncCount: number;
  importedFuncTypeIndices: number[];
  funcTypeIndices: number[];
  globalInfos: GlobalInfo[];
  tableNames: string[];
  tagInfos: TagInfo[];
  /**
   * Every tag's payload types, in the tag INDEX space — imports first. `tagInfos`
   * holds the DEFINED tags only, so it cannot be indexed by a tag index.
   */
  tagParams: ValueType[][];
  /** See {@link ParseWasmOptions.lowerBlockParams}. */
  lowerBlockParams: boolean;
  /** Every entity's name, by index — from the name section where it has one (N1 P4). */
  names: DecodedNames;
}

/** Options for {@link parseWasm}. */
export interface ParseWasmOptions {
  /**
   * Lower block, loop, if, try and try_table PARAMETERS to locals while
   * decoding, instead of keeping them on the node.
   *
   * Off by default: a parametrised construct keeps its `params` and its body
   * starts with one `Pop` per parameter, so it re-encodes as written (S6
   * decision 7b(i)). On, the decoder spills each entry value to a fresh local
   * and rewrites branches to parametrised loops — the IR upstream binaryen's
   * reader produces and every pass here was written against. `PassRunner`
   * asks for it before the first pass runs; it is public for anyone who wants
   * that IR directly.
   */
  lowerBlockParams?: boolean;
}

// ---------------------------------------------------------------------------
// Opcode tables
// ---------------------------------------------------------------------------

const UNARY_OPCODE: Record<number, UnaryOp> = {
  0x45: UnaryOp.EqzI32,
  0x50: UnaryOp.EqzI64,
  0x67: UnaryOp.ClzI32,
  0x68: UnaryOp.CtzI32,
  0x69: UnaryOp.PopcntI32,
  0x79: UnaryOp.ClzI64,
  0x7a: UnaryOp.CtzI64,
  0x7b: UnaryOp.PopcntI64,
  0x8b: UnaryOp.AbsF32,
  0x8c: UnaryOp.NegF32,
  0x8d: UnaryOp.CeilF32,
  0x8e: UnaryOp.FloorF32,
  0x8f: UnaryOp.TruncF32,
  0x90: UnaryOp.NearestF32,
  0x91: UnaryOp.SqrtF32,
  0x99: UnaryOp.AbsF64,
  0x9a: UnaryOp.NegF64,
  0x9b: UnaryOp.CeilF64,
  0x9c: UnaryOp.FloorF64,
  0x9d: UnaryOp.TruncF64,
  0x9e: UnaryOp.NearestF64,
  0x9f: UnaryOp.SqrtF64,
  0xa7: UnaryOp.WrapI64,
  0xa8: UnaryOp.TruncSF32ToI32,
  0xa9: UnaryOp.TruncUF32ToI32,
  0xaa: UnaryOp.TruncSF64ToI32,
  0xab: UnaryOp.TruncUF64ToI32,
  0xac: UnaryOp.ExtendSI32,
  0xad: UnaryOp.ExtendUI32,
  0xae: UnaryOp.TruncSF32ToI64,
  0xaf: UnaryOp.TruncUF32ToI64,
  0xb0: UnaryOp.TruncSF64ToI64,
  0xb1: UnaryOp.TruncUF64ToI64,
  0xb2: UnaryOp.ConvertSI32ToF32,
  0xb3: UnaryOp.ConvertUI32ToF32,
  0xb4: UnaryOp.ConvertSI64ToF32,
  0xb5: UnaryOp.ConvertUI64ToF32,
  0xb6: UnaryOp.DemoteF64,
  0xb7: UnaryOp.ConvertSI32ToF64,
  0xb8: UnaryOp.ConvertUI32ToF64,
  0xb9: UnaryOp.ConvertSI64ToF64,
  0xba: UnaryOp.ConvertUI64ToF64,
  0xbb: UnaryOp.PromoteF32,
  0xbc: UnaryOp.ReinterpretF32,
  0xbd: UnaryOp.ReinterpretF64,
  0xbe: UnaryOp.ReinterpretI32,
  0xbf: UnaryOp.ReinterpretI64,
  0xc0: UnaryOp.ExtendS8I32,
  0xc1: UnaryOp.ExtendS16I32,
  0xc2: UnaryOp.ExtendS8I64,
  0xc3: UnaryOp.ExtendS16I64,
  0xc4: UnaryOp.ExtendS32I64,
};

const BINARY_OPCODE: Record<number, BinaryOp> = {
  0x46: BinaryOp.EqI32,
  0x47: BinaryOp.NeI32,
  0x48: BinaryOp.LtSI32,
  0x49: BinaryOp.LtUI32,
  0x4a: BinaryOp.GtSI32,
  0x4b: BinaryOp.GtUI32,
  0x4c: BinaryOp.LeSI32,
  0x4d: BinaryOp.LeUI32,
  0x4e: BinaryOp.GeSI32,
  0x4f: BinaryOp.GeUI32,
  0x51: BinaryOp.EqI64,
  0x52: BinaryOp.NeI64,
  0x53: BinaryOp.LtSI64,
  0x54: BinaryOp.LtUI64,
  0x55: BinaryOp.GtSI64,
  0x56: BinaryOp.GtUI64,
  0x57: BinaryOp.LeSI64,
  0x58: BinaryOp.LeUI64,
  0x59: BinaryOp.GeSI64,
  0x5a: BinaryOp.GeUI64,
  0x5b: BinaryOp.EqF32,
  0x5c: BinaryOp.NeF32,
  0x5d: BinaryOp.LtF32,
  0x5e: BinaryOp.GtF32,
  0x5f: BinaryOp.LeF32,
  0x60: BinaryOp.GeF32,
  0x61: BinaryOp.EqF64,
  0x62: BinaryOp.NeF64,
  0x63: BinaryOp.LtF64,
  0x64: BinaryOp.GtF64,
  0x65: BinaryOp.LeF64,
  0x66: BinaryOp.GeF64,
  0x6a: BinaryOp.AddI32,
  0x6b: BinaryOp.SubI32,
  0x6c: BinaryOp.MulI32,
  0x6d: BinaryOp.DivSI32,
  0x6e: BinaryOp.DivUI32,
  0x6f: BinaryOp.RemSI32,
  0x70: BinaryOp.RemUI32,
  0x71: BinaryOp.AndI32,
  0x72: BinaryOp.OrI32,
  0x73: BinaryOp.XorI32,
  0x74: BinaryOp.ShlI32,
  0x75: BinaryOp.ShrSI32,
  0x76: BinaryOp.ShrUI32,
  0x77: BinaryOp.RotlI32,
  0x78: BinaryOp.RotrI32,
  0x7c: BinaryOp.AddI64,
  0x7d: BinaryOp.SubI64,
  0x7e: BinaryOp.MulI64,
  0x7f: BinaryOp.DivSI64,
  0x80: BinaryOp.DivUI64,
  0x81: BinaryOp.RemSI64,
  0x82: BinaryOp.RemUI64,
  0x83: BinaryOp.AndI64,
  0x84: BinaryOp.OrI64,
  0x85: BinaryOp.XorI64,
  0x86: BinaryOp.ShlI64,
  0x87: BinaryOp.ShrSI64,
  0x88: BinaryOp.ShrUI64,
  0x89: BinaryOp.RotlI64,
  0x8a: BinaryOp.RotrI64,
  0x92: BinaryOp.AddF32,
  0x93: BinaryOp.SubF32,
  0x94: BinaryOp.MulF32,
  0x95: BinaryOp.DivF32,
  0x96: BinaryOp.MinF32,
  0x97: BinaryOp.MaxF32,
  0x98: BinaryOp.CopySignF32,
  0xa0: BinaryOp.AddF64,
  0xa1: BinaryOp.SubF64,
  0xa2: BinaryOp.MulF64,
  0xa3: BinaryOp.DivF64,
  0xa4: BinaryOp.MinF64,
  0xa5: BinaryOp.MaxF64,
  0xa6: BinaryOp.CopySignF64,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a heap type from a SLEB128-encoded signed integer. */
/** Abstract heap type → the abstract `ValType` that spells `(ref null <ht>)`. */
const ABSTRACT_HEAP_TO_VALTYPE: Record<AbstractHeapType, ValType> = {
  [AbstractHeapType.Func]: ValType.FuncRef,
  [AbstractHeapType.NoFunc]: ValType.NullFuncRef,
  [AbstractHeapType.Ext]: ValType.ExternRef,
  [AbstractHeapType.NoExt]: ValType.NullExternRef,
  [AbstractHeapType.Any]: ValType.AnyRef,
  [AbstractHeapType.Eq]: ValType.EqRef,
  [AbstractHeapType.I31]: ValType.I31Ref,
  [AbstractHeapType.Struct]: ValType.StructRef,
  [AbstractHeapType.Array]: ValType.ArrayRef,
  [AbstractHeapType.None]: ValType.NullRef,
  [AbstractHeapType.Exn]: ValType.ExnRef,
  [AbstractHeapType.NoExn]: ValType.NullExnRef,
};

/**
 * Decodes the heap-type operand of `ref.null` into the null's own type.
 *
 * Both decode sites used to do `r.readU8()` then
 * `ht === 0x70 ? FuncRef : ExternRef`, which is wrong twice over:
 *
 *  - it read a single byte, but a heap type is a signed LEB (`s33`), so a
 *    concrete `ref.null $T` with a type index ≥ 64 was misparsed outright; and
 *  - it mapped EVERY non-`func` heap type to `externref`, so `ref.null none`
 *    and `ref.null noextern` both re-encoded as `ref.null extern`. In
 *    `gc_target_feature.wasm` that turned a valid `(global (mut eqref)
 *    (ref.null none))` into one V8 rejects: "type error in constant
 *    expression[0] (expected eqref, got externref)".
 *
 * An abstract heap type maps back to the abstract `ValType` that names it (so
 * the IR shape is unchanged for non-GC modules); a concrete type index becomes
 * a real `RefType`.
 */
function readRefNullType(r: BinaryReader): ValueType {
  const ht = readHeapType(r);
  if (ht.kind !== 'abstract') return { heapType: ht, nullable: true };
  return ABSTRACT_HEAP_TO_VALTYPE[ht.name];
}

function readHeapType(r: BinaryReader): HeapType {
  const v = r.readI32(); // heap types encoded as signed LEB128
  switch (v) {
    case -0x10:
      return heapAbstract(AbstractHeapType.Func);
    case -0x0d:
      return heapAbstract(AbstractHeapType.NoFunc);
    case -0x11:
      return heapAbstract(AbstractHeapType.Ext);
    case -0x0e:
      return heapAbstract(AbstractHeapType.NoExt);
    case -0x12:
      return heapAbstract(AbstractHeapType.Any);
    case -0x13:
      return heapAbstract(AbstractHeapType.Eq);
    case -0x14:
      return heapAbstract(AbstractHeapType.I31);
    case -0x15:
      return heapAbstract(AbstractHeapType.Struct);
    case -0x16:
      return heapAbstract(AbstractHeapType.Array);
    case -0x0f:
      return heapAbstract(AbstractHeapType.None);
    case -0x17:
      return heapAbstract(AbstractHeapType.Exn);
    case -0x0c:
      return heapAbstract(AbstractHeapType.NoExn);
    default:
      if (v >= 0) return varIndex(v); // type index
      // Unknown abstract heap-type byte — silently returning `any` mistyped the
      // reference. Fail loudly, matching readValTypeByte.
      return r.error(`unknown heap type: SLEB ${v}`);
  }
}

/** Read a value type or reference type from the binary stream. */
function readValueType(r: BinaryReader): ValType | RefType {
  const b = r.readU8();
  switch (b) {
    case 0x7f:
      return ValType.I32;
    case 0x7e:
      return ValType.I64;
    case 0x7d:
      return ValType.F32;
    case 0x7c:
      return ValType.F64;
    case 0x7b:
      return ValType.V128;
    // Abstract nullable reference types (shorthand encodings)
    case 0x70:
      return ValType.FuncRef;
    case 0x6f:
      return ValType.ExternRef;
    case 0x6e:
      return ValType.AnyRef;
    case 0x6d:
      return ValType.EqRef;
    case 0x6c:
      return ValType.I31Ref;
    case 0x6b:
      return ValType.StructRef;
    case 0x6a:
      return ValType.ArrayRef;
    case 0x73:
      return ValType.NullFuncRef;
    case 0x72:
      return ValType.NullExternRef;
    case 0x71:
      return ValType.NullRef;
    case 0x69:
      return ValType.ExnRef;
    case 0x74:
      return ValType.NullExnRef;
    // Typed reference: (ref null $T) = 0x63, (ref $T) = 0x64
    case 0x63:
      return { heapType: readHeapType(r), nullable: true };
    case 0x64:
      return { heapType: readHeapType(r), nullable: false };
    default:
      r.error(`unknown valtype byte 0x${b.toString(16)}`);
  }
}

/** Legacy shim — returns ValType for positions that still use ValType. */
/**
 * Reads one value type.
 *
 * This used to widen every concrete typed reference to `ValType.AnyRef`,
 * because locals/globals/tables/tags/params were all modelled as `ValType`.
 * That was lossy in the worst way: a local declared `(ref null $T)` came back
 * as `anyref`, so re-encoding a GC module produced one engines reject. Those
 * positions are `ValueType` now, so the type is carried through exactly.
 */
function readValTypeByte(r: BinaryReader): ValueType {
  return readValueType(r);
}

/**
 * Type of local `idx`, or a loud error.
 *
 * The old `locals[idx]?.type ?? ValType.I32` silently typed an out-of-range
 * local as i32 — the same silent-default class as the `?? 0` index fallbacks.
 * An out-of-range local index is malformed wasm; say so.
 */
/**
 * Type of global `idx`, or a loud error.
 *
 * `globalInfos[idx]?.type ?? ValType.I32` silently typed an out-of-range global
 * read as i32 — the same silent-default class as {@link localTypeAt}. An i32
 * `global.get` standing in for an i64/f64/ref global mis-drives every
 * type-sensitive pass downstream and can be encoded back out at the wrong
 * width. An out-of-range global index is malformed wasm; say so.
 */
function globalTypeAt(
  globals: { type: ValueType }[],
  idx: number,
  r: BinaryReader,
): ValueType {
  const gi = globals[idx];
  if (gi === undefined) {
    return r.error(`global index ${idx} is out of range (module declares ${globals.length})`);
  }
  return gi.type;
}

function localTypeAt(locals: Local[], idx: number, r: BinaryReader): ValueType {
  const loc = locals[idx];
  if (loc === undefined) {
    return r.error(`local index ${idx} is out of range (function declares ${locals.length})`);
  }
  return loc.type;
}

interface BlockSignature {
  params: ValueType[];
  results: ValueType[];
  /**
   * The type-section index the header NAMED, when it was written as one — S6
   * decision 7c. A header with no parameters and one result has two legal
   * spellings, an inline value type and an index, and they are different bytes;
   * only the choice is unrecoverable from the signature.
   */
  typeIndex?: number;
}

function readBlockType(r: BinaryReader, funcTypes: (FuncType | null)[]): BlockSignature {
  const b = r.peekU8();
  if (b === 0x40) {
    r.readU8();
    return { params: [], results: [] };
  }
  // Any value type byte (MVP + GC + EH ref types)
  if (
    b === 0x7f || b === 0x7e || b === 0x7d || b === 0x7c || b === 0x7b ||
    b === 0x70 || b === 0x6f || b === 0x6e || b === 0x6d || b === 0x6c ||
    b === 0x6b || b === 0x6a || b === 0x73 || b === 0x72 || b === 0x71 ||
    b === 0x69 || b === 0x74 ||
    b === 0x63 || b === 0x64
  ) {
    return { params: [], results: [readValueType(r)] };
  }
  // Type-index blocktype: the block carries a full function signature, so it
  // may have multiple results AND/OR inputs. Encoded as a NON-NEGATIVE signed
  // LEB (`s33`) — that is what distinguishes it from the negative one-byte
  // valtype forms handled above.
  //
  // Multi-RESULT blocks are supported. Blocks with INPUTS are not: `BlockExpr`
  // has no way to model consuming values from the enclosing operand stack, so
  // accepting one would mean silently dropping its parameters. Reject loudly —
  // the same stance the whole pipeline takes on constructs it cannot represent.
  const typeIdx = r.readI32();
  const ft = funcTypes[typeIdx];
  if (ft == null) {
    return r.error(
      ft === undefined
        ? `block type index ${typeIdx} is out of range`
        : `block type index ${typeIdx} is not a function type`,
    );
  }
  return { params: [...ft.params], results: [...ft.results], typeIndex: typeIdx };
}

/**
 * Resolves a type-section index to a FUNCTION type, or throws.
 *
 * The `?? { params: [], results: [] }` this replaces was the WT-2b
 * "call need N got M" shape arriving from a different direction: an
 * out-of-range index (or one naming a struct/array entry) yielded an empty
 * signature, so the decoder popped no operands and built a call node of the
 * wrong arity — a different program, decoded without a diagnostic.
 */
function funcTypeAt(
  funcTypes: (FuncType | null)[],
  idx: number | undefined,
  r: BinaryReader,
  what: string,
): FuncType {
  if (idx === undefined) return r.error(`${what}: no type index`);
  const ft = funcTypes[idx];
  if (ft === undefined) return r.error(`${what}: type index ${idx} is out of range`);
  if (ft === null) return r.error(`${what}: type index ${idx} is not a function type`);
  return ft;
}

/**
 * A memarg: alignment exponent, optional memory index, offset.
 *
 * ⚠️ **Bit 6 of the align field means "an explicit memory index follows"**
 * (multi-memory). Reading align and offset straight through, as this did, is a
 * DESYNC rather than a lost operand: for `i32.load (memory 1)` — `28 42 01 00` —
 * it returned align 0x42 (a nonsense 2^66 alignment) and offset 1, then left the
 * real offset byte in the stream where the next decode step consumed it as an
 * OPCODE. A `00` became a phantom `unreachable`, which makes everything after it
 * dead code, so any pass reading that body was reading a different program.
 *
 * Nothing caught it: no error is raised here, and `checkSingleMemory` in the
 * encoder only fires if the module is re-encoded. Same failure shape as the
 * typed-ref block type in wabt-ts (`block_type_ref.test.ts`).
 */
function readMemArg(r: BinaryReader): { align: number; offset: bigint; memory: Var } {
  const flags = r.readU32();
  const memory = varIndex((flags & 0x40) !== 0 ? r.readU32() : 0);
  // u64, not u32: a memory64 offset exceeds 2^32 and `readU32` would truncate
  // it, decoding a valid module into one that addresses a different address.
  // Wrapping the result in `BigInt(...)` at each call site would widen the
  // TYPE while keeping the loss.
  const offset = r.readU64();
  return { align: flags & ~0x40, offset, memory };
}

/**
 * The innermost open control frame, or a typed error.
 *
 * Every `frames[frames.length - 1]` was an unchecked read whose result was then
 * dereferenced repeatedly (`frame.kind`, `frame.exprs`, `frame.tryBody`, …), so
 * one malformed instruction stream — an `end` with no matching frame, a `catch`
 * outside a `try` — produced a raw `TypeError` from deep inside the decoder
 * with no offset and no diagnostic. Reading through here makes the whole
 * cluster a single `WasmBinaryError`.
 */
function topFrame(frames: ControlFrame[], r: BinaryReader): ControlFrame {
  const f = frames[frames.length - 1];
  if (f === undefined) return r.error('control frame stack underflow');
  return f;
}

/** { topFrame}, popping it. */
function popFrame(frames: ControlFrame[], r: BinaryReader): ControlFrame {
  const f = frames.pop();
  if (f === undefined) return r.error('control frame stack underflow');
  return f;
}

function resolveLabel(frames: ControlFrame[], depth: number): string {
  const idx = frames.length - 1 - depth;
  const frame = frames[idx];
  if (frame === undefined) return `$label${depth}`;
  return frame.label;
}

/**
 * Returns the number of values a branch to `depth` consumes from the operand
 * stack. For `loop`, MVP semantics: branching jumps to the loop entry and
 * consumes no inputs (multi-value loops with inputs are post-MVP). For all
 * other frames (`block` / `if` / `try` / `try_table` / `func`), consumes the
 * target's result-type arity.
 *
 * @internal
 */
function _branchValueArity(frames: ControlFrame[], depth: number): number {
  const idx = frames.length - 1 - depth;
  const target = frames[idx];
  if (target === undefined) return 0;
  // Branching to a loop jumps to its ENTRY, so it consumes the loop's
  // PARAMETERS (0 for an MVP loop, N for a parametrised one) — never its
  // results. Every other frame consumes its result arity.
  // (Kept parameters: the branch carries them. Lowered: `rewriteLoopBranch`
  // handles the branch before this is asked.)
  if (target.kind === 'loop') return target.paramTypes?.length ?? 0;
  return target.resultTypes.length;
}

/**
 * Pops `n` values into a list in STACK order — the first-pushed first, since
 * the last operand is on top of the stack.
 *
 * @internal
 */
function _popValues(n: number, pop: () => Expression): Expression[] {
  const vals: Expression[] = [];
  for (let i = 0; i < n; i++) vals.unshift(pop());
  return vals;
}

/**
 * The values a branch to `depth` carries — as many as the target consumes.
 *
 * @internal
 */
function _branchValues(
  frames: ControlFrame[],
  depth: number,
  pop: () => Expression,
): Expression[] {
  return _popValues(_branchValueArity(frames, depth), pop);
}

/**
 * The `Type` a result-type list denotes: `None` for empty, the scalar for one,
 * the tuple itself for many. Same story — four copies, one meaning.
 */
function resultTypeOf(results: ValueType[]): Type {
  if (results.length === 0) return None;
  return results.length === 1 ? results[0]! : results;
}

/**
 * A frame's instructions as the region they are — exactly as decoded, 0, 1 or
 * N of them.
 *
 * 🔧 This built a WRAPPER, and the wrapper's history is the case for a region:
 * an empty body became a `nop` the binary never held; a reused label made a
 * back-edge `br $L` target the wrapper, turning a `continue` into an exit; and
 * a wrapper typed by inference came out `unreachable`, was emitted with a void
 * blocktype, and absorbed the value a result-typed loop owed. A region has no
 * label, never writes a blocktype, and holds what was there — so its type is
 * simply its contents' type; the declared one stays on the construct.
 */
function sealFrame(frame: ControlFrame): RegionExpr {
  return makeRegion(frame.exprs);
}

// ---------------------------------------------------------------------------
// Main parser class
// ---------------------------------------------------------------------------

class WasmParser {
  private readonly r: BinaryReader;
  private readonly builder = new ModuleBuilder();
  private funcTypes: (FuncType | null)[] = [];
  private heapTypeDefs: TypeDef[] = [];
  private importedFuncCount = 0;
  private importedFuncTypeIndices: number[] = [];
  private funcTypeIndices: number[] = [];
  private globalInfos: GlobalInfo[] = [];
  private tableNames: string[] = [];
  private tagInfos: TagInfo[] = [];
  /** See {@link DecoderCtx.tagParams}. */
  private readonly tagParams: ValueType[][] = [];
  private importedTagCount = 0;
  /** Memories so far, imported and defined — the memory index space. */
  private memoryCount = 0;
  /** Whether the binary had a DataCount section. See {@link WasmModule.hasDataCount}. */
  private hasDataCount = false;
  /** Custom sections, in binary order. See {@link WasmModule.customSections} (C3). */
  private readonly customSections: CustomSection[] = [];
  /** Where in {@link customSections} the `name` section's place sits, if any. */
  private nameSectionAt: number | null = null;
  /** The last KNOWN section read — what a custom section's position is recorded against. */
  private lastKnownSection: number | null = null;
  /** Imported functions' names, by function index. */
  private readonly importFuncNames: string[] = [];
  private readonly lowerBlockParams: boolean;
  /**
   * Every entity's name, from the name section where it has one — read FIRST,
   * though the section comes after the code, because every reference site
   * needs the name its target will have. See `names.ts`.
   */
  private readonly names: DecodedNames;

  constructor(bytes: Uint8Array, options: ParseWasmOptions = {}) {
    this.r = new BinaryReader(bytes);
    this.lowerBlockParams = options.lowerBlockParams ?? false;
    this.names = new DecodedNames(bytes);
  }

  parse(): WasmModule {
    this.readHeader();
    this.readSections();
    const mod = this.builder.build();
    return {
      ...mod,
      heapTypes: this.heapTypeDefs,
      hasGC: this.heapTypeDefs.length > 0,
      // Use the name `readTagSection` assigned, NOT a fresh `$tag${i}`:
      // with imported tags present the defined ones start above zero, and
      // renumbering here would desync every throw / catch / tag export.
      tags: this.tagInfos.map((t) => ({ name: t.name, params: t.params })),
      hasExceptionHandling: this.tagInfos.length > 0 || mod.hasExceptionHandling,
      ...(this.hasDataCount ? { hasDataCount: true } : {}),
      ...(this.customSections.length > 0 ? { customSections: this.customSections } : {}),
      // Only when the binary HAD a name section: one without must not gain one.
      ...(this.names.hasSection
        ? {
          explicitNames: this.names.explicit(
            (i) => this.names.func(i),
            this.heapTypeDefs,
            this.importFuncNames,
          ),
        }
        : {}),
    };
  }

  private readHeader(): void {
    const magic = this.r.readU32Fixed();
    if (magic !== 0x6d736100) this.r.error('invalid WASM magic');
    const version = this.r.readU32Fixed();
    if (version !== 1) this.r.error(`unsupported WASM version ${version}`);
  }

  private readSections(): void {
    while (!this.r.eof) {
      const id = this.r.readU8();
      const size = this.r.readU32();
      const start = this.r.position;
      const end = start + size;

      switch (id) {
        case SECTION_TYPE:
          this.readTypeSection();
          break;
        case SECTION_IMPORT:
          this.readImportSection();
          break;
        case SECTION_FUNCTION:
          this.readFunctionSection();
          break;
        case SECTION_TABLE:
          this.readTableSection();
          break;
        case SECTION_MEMORY:
          this.readMemorySection();
          break;
        case SECTION_GLOBAL:
          this.readGlobalSection();
          break;
        case SECTION_EXPORT:
          this.readExportSection();
          break;
        case SECTION_START: {
          // The start function runs at instantiation. Reading the index and
          // discarding it (as this did) dropped the section on re-encode: a
          // module whose start function initialized state came back valid but
          // inert — valid wasm, wrong behaviour, no diagnostic. Materialize it
          // under the same `$func${globalIndex}` naming every other reference
          // site uses, so the encoder can resolve it back to an index.
          const startIdx = this.r.readU32();
          this.builder.setStart(this.names.func(startIdx));
          break;
        }
        case SECTION_ELEMENT:
          this.readElementSection(end);
          break;
        case SECTION_CODE:
          this.readCodeSection();
          break;
        case SECTION_DATA:
          this.readDataSection();
          break;
        case SECTION_DATA_COUNT:
          this.r.readU32();
          // Kept so the encoder re-emits a DataCount the module did not need (W6).
          this.hasDataCount = true;
          break;
        case SECTION_TAG:
          this.readTagSection();
          break;
        case SECTION_CUSTOM:
          this.readCustomSection(start, end);
          break;
        // Note: `lastKnownSection` is updated below, after the switch, for
        // every id but this one.
        default:
          // Skipping an unknown section id dropped it from the re-encoded
          // module with no diagnostic — the same shape as the start section
          // above, which came back "valid wasm, wrong behaviour" until it was
          // materialized. A section this decoder does not know is a construct
          // the module needs, so refuse rather than emit a quietly different
          // program. (Custom sections, id 0, have their own case and are a
          // documented drop.)
          this.r.error(`unknown section id ${id}`);
          break;
      }

      if (id !== SECTION_CUSTOM) this.lastKnownSection = id;
      if (this.r.position !== end) this.r.seek(end);
    }
  }

  private readTypeSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      this.readTypeDef();
    }
  }

  private readStorageType(): StorageType {
    const b = this.r.peekU8();
    if (b === 0x78) {
      this.r.readU8();
      return 'i8';
    }
    if (b === 0x77) {
      this.r.readU8();
      return 'i16';
    }
    return readValueType(this.r);
  }

  private readFieldType(): FieldType {
    const type = this.readStorageType();
    const mutable = this.r.readU8() !== 0;
    return { type, mutable };
  }

  private readTypeDef(): void {
    let tag = this.r.readU8();
    // Sub / SubFinal wrappers: skip supertype list, read inner type
    if (tag === 0x50 || tag === 0x4f) {
      const n = this.r.readU32();
      for (let i = 0; i < n; i++) this.r.readU32(); // supertype indices
      tag = this.r.readU8(); // actual type form
    }
    // Rec group: read count then delegate to inner readTypeDef calls
    if (tag === 0x4e) {
      const n = this.r.readU32();
      for (let i = 0; i < n; i++) this.readTypeDef();
      return; // rec group itself doesn't produce a single TypeDef entry
    }
    if (tag === 0x60) { // func type
      const paramCount = this.r.readU32();
      const params: (ValType | RefType)[] = [];
      for (let j = 0; j < paramCount; j++) params.push(readValueType(this.r));
      const resultCount = this.r.readU32();
      const results: (ValType | RefType)[] = [];
      for (let j = 0; j < resultCount; j++) results.push(readValueType(this.r));
      const def: TypeDef = { kind: 'func', params, results };
      this.heapTypeDefs.push(def);
      // `funcTypes` mirrors the heap-type entry exactly — concrete typed
      // references included. It used to collapse them to AnyRef, which is what
      // made two func types differing only in their heap types indistinguishable
      // at encode time (the old "ambiguous GC function type" throw).
      this.funcTypes.push({ params: [...params], results: [...results] });
      return;
    }
    if (tag === 0x5f) { // struct type
      const fieldCount = this.r.readU32();
      const fields: FieldType[] = [];
      for (let j = 0; j < fieldCount; j++) fields.push(this.readFieldType());
      this.heapTypeDefs.push({ kind: 'struct', fields });
      this.funcTypes.push(null); // not a function type; keeps indices aligned
      return;
    }
    if (tag === 0x5e) { // array type
      const element = this.readFieldType();
      this.heapTypeDefs.push({ kind: 'array', element });
      this.funcTypes.push(null); // not a function type; keeps indices aligned
      return;
    }
    // Unknown type form — skip gracefully via error (will be caught by caller)
    this.r.error(`unknown type form tag 0x${tag.toString(16)}`);
  }

  private readImportSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const modLen = this.r.readU32();
      const module = this.r.readUTF8(modLen);
      const baseLen = this.r.readU32();
      const base = this.r.readUTF8(baseLen);
      const kind = this.r.readU8();
      switch (kind) {
        case 0x00: { // function
          const typeIdx = this.r.readU32();
          const ft = funcTypeAt(this.funcTypes, typeIdx, this.r, 'imported function');
          // Imported functions occupy the low end of the single function index
          // space (global indices 0..importedFuncCount-1), so they MUST share
          // the `$func${globalIndex}` naming used by every reference site —
          // calls (0x10/0x12), exports, element segments, and ref.func all emit
          // `$func${idx}`. Naming imports `$import${n}` instead left those
          // references dangling: the encoder's funcIndex map keyed imports by
          // their (mismatched) name, so `funcIndex.get("$func1")` missed and
          // fell back to `?? 0`, encoding every imported-function call as index
          // 0 (wrong target, wrong arity → "call need N got M"). The shared
          // naming is now `this.names`, which every site asks by index.
          const name = this.names.func(this.importedFuncCount);
          this.importFuncNames.push(name);
          this.builder.addFunctionImport(name, module, base, ft.params, ft.results);
          this.importedFuncTypeIndices.push(typeIdx);
          this.importedFuncCount++;
          break;
        }
        case 0x01: { // table
          const elemType = readValTypeByte(this.r);
          const hasMax = this.r.readU8();
          const initial = this.r.readU32();
          const max = hasMax ? this.r.readU32() : null;
          const tname = this.names.table(this.tableNames.length);
          this.tableNames.push(tname);
          this.builder.addTableImport(tname, module, base, elemType, initial, max);
          break;
        }
        case 0x02: { // memory
          const flags = this.r.readU8();
          const shared = (flags & 0x02) !== 0;
          const is64 = (flags & 0x04) !== 0;
          const hasMax = (flags & 0x01) !== 0;
          const initial = this.r.readU32();
          const max = hasMax ? this.r.readU32() : null;
          // By index like every other memory. This was 'mem0' for EVERY
          // imported memory, which collided with the first defined one — named
          // `mem0` too — and with each other under multi-memory.
          const mname = this.names.memory(this.memoryCount++);
          this.builder.addMemoryImport(mname, module, base, initial, max, shared, is64);
          break;
        }
        case 0x03: { // global
          const type = readValTypeByte(this.r);
          const mutable = this.r.readU8() !== 0;
          const gname = this.names.global(this.globalInfos.length);
          this.globalInfos.push({ type, mutable });
          this.builder.addGlobalImport(gname, module, base, type, mutable);
          break;
        }
        case 0x04: { // tag (EH proposal)
          this.r.readU8(); // reserved attribute byte (must be 0)
          const typeIdx = this.r.readU32();
          const ft = funcTypeAt(this.funcTypes, typeIdx, this.r, 'imported tag');
          // Imported tags occupy the low end of the tag index space, so they
          // MUST share the `$tag${globalIndex}` naming every reference site
          // uses (throw / catch / try_table / tag exports). Naming them on a
          // separate counter would leave those references dangling in exactly
          // the way `$import${n}` once did for functions.
          const name = this.names.tag(this.importedTagCount);
          this.builder.addTagImport(name, module, base, ft.params);
          this.tagParams.push(ft.params);
          this.importedTagCount++;
          break;
        }
        default:
          this.r.error(`unknown import kind 0x${kind.toString(16)}`);
      }
    }
  }

  private readFunctionSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      this.funcTypeIndices.push(this.r.readU32());
    }
  }

  private readTableSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const elemType = readValTypeByte(this.r);
      const hasMax = this.r.readU8();
      const initial = this.r.readU32();
      const max = hasMax ? this.r.readU32() : null;
      const name = this.names.table(this.tableNames.length);
      this.tableNames.push(name);
      this.builder.addTable(name, elemType, initial, max);
    }
  }

  private readMemorySection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const flags = this.r.readU8();
      const shared = (flags & 0x02) !== 0;
      const is64 = (flags & 0x04) !== 0;
      const hasMax = (flags & 0x01) !== 0;
      const initial = this.r.readU32();
      const max = hasMax ? this.r.readU32() : null;
      // In the memory INDEX space, imports first — as the export section names
      // them. `mem${i}` counted defined memories only.
      this.builder.addMemory(this.names.memory(this.memoryCount++), initial, max, shared, is64);
    }
  }

  private readGlobalSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const type = readValTypeByte(this.r);
      const mutable = this.r.readU8() !== 0;
      const init = this.readInitExpr(type);
      const name = this.names.global(this.globalInfos.length);
      this.globalInfos.push({ type, mutable });
      this.builder.addGlobal(name, type, mutable, init);
    }
  }

  private readExportSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const nameLen = this.r.readU32();
      const name = this.r.readUTF8(nameLen);
      const kind = this.r.readU8();
      const index = this.r.readU32();
      switch (kind) {
        case 0x00: { // function
          this.builder.addExport(name, this.names.func(index), 'function');
          break;
        }
        case 0x01: { // table
          this.builder.addExport(name, this.names.table(index), 'table');
          break;
        }
        case 0x02: // memory
          // Named by index, matching the names addMemory assigns. Hardcoding
          // 'mem0' here silently re-pointed every memory export at memory 0.
          this.builder.addExport(name, this.names.memory(index), 'memory');
          break;
        case 0x03: { // global
          this.builder.addExport(name, this.names.global(index), 'global');
          break;
        }
        case 0x04: { // tag (EH proposal)
          // Tags are named `$tag${n}` consistently with `readTagSection`. Note
          // that the export section is parsed BEFORE the tag section in normal
          // wasm modules, so the actual `tagInfos[index]` may not yet exist;
          // we use the canonical name regardless, matching what the tag-section
          // reader will assign. Without this case, every `(export ... (tag ...))`
          // was silently dropped, which broke wasic-emitted modules that
          // export `__exn_tag` (and reproduced as "tag export stripped" in the
          // wasmtk team's bug report against v1.2.2).
          this.builder.addExport(name, this.names.tag(index), 'tag');
          break;
        }
        default:
          // A silently-skipped export is exactly how tag exports (kind 0x04)
          // went missing before that case above existed: the module round-
          // tripped minus an export, with no diagnostic. The import section
          // already errors on an unknown kind; match it.
          this.r.error(`unknown export kind 0x${kind.toString(16)}`);
      }
    }
  }

  private readElementSection(end: number): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      if (this.r.position >= end) break;
      // Element-segment flags bitfield (reference-types proposal):
      //   bit 0 — passive/declarative (clear ⇒ active)
      //   bit 1 — when active: explicit table index; when bit 0 set: declarative
      //   bit 2 — element list is a vec(expr) of reftype, not vec(funcidx)
      // The eight resulting forms (0..7) differ in which fields are present:
      //   tableidx?  offset(expr)?  elemkind/reftype-byte?  then the vector.
      // The legacy active form (flag 0) and the active funcref-expr form
      // (flag 4) are the only two with NO kind/reftype byte. wabt with
      // reference-types enabled emits flag 4 for `(elem (offset) func $a $b)`,
      // which the old `segKind === 0`-only reader silently dropped — leaving
      // the table unpopulated so every `call_indirect` trapped.
      // The leading value is a BITFIELD, not an enum:
      //   bit 0 - not active on table 0 (passive, or declarative with bit 1)
      //   bit 1 - with bit 0: declarative; without it: an explicit table index
      //   bit 2 - element EXPRESSIONS rather than function indices
      //
      // Passive and declarative segments used to be REFUSED here, because the
      // IR modelled only active table initializers. `ElementSegment.mode` lifts
      // that. The loss it was protecting against was real: a passive segment a
      // `table.init` would consume, or a declarative forward declaration whose
      // absence makes a re-encoded `ref.func` invalid.
      const flags = this.r.readU32();
      const mode: ElementSegmentMode = (flags & 1) === 0
        ? 'active'
        : (flags & 2) !== 0
        ? 'declarative'
        : 'passive';

      // An explicit table index is bit 1 WITHOUT bit 0. Reading it as `flags & 2`
      // alone would consume a table index from a declarative segment, which has
      // none - correct only while the guard above made flags 3 and 7 unreachable.
      const hasTableIndex = (flags & 3) === 2;
      const useExpressions = (flags & 4) !== 0;

      let tableIdx = 0;
      if (hasTableIndex) tableIdx = this.r.readU32();

      // Only an active segment carries an offset.
      const offset = mode === 'active' ? this.readInitExpr(ValType.I32) : null;

      // A 1-byte elemkind (non-expr forms) or reftype (expr forms) precedes the
      // vector for every flag except 0 and 4. We only support funcref tables,
      // so the byte is read and discarded.
      if (flags !== 0 && flags !== 4) this.r.readU8();

      const numElems = this.r.readU32();
      const funcs: string[] = [];
      for (let j = 0; j < numElems; j++) {
        funcs.push(
          useExpressions ? this.readElemExprFuncName() : this.names.func(this.r.readU32()),
        );
      }

      const tname = this.tableNames[tableIdx] ?? this.tableNames[0] ?? this.names.table(0);
      const seg: ElementSegment = {
        name: this.names.elem(i),
        mode,
        table: tname,
        offset,
        data: funcs,
      };
      this.builder.addElement(seg);
    }
  }

  /**
   * Read one element-list expression (flag-4/5/6/7 forms) and return the
   * referenced function name.
   */
  private readElemExprFuncName(): string {
    const opcode = this.r.readU8();
    if (opcode === 0xd2) {
      // ref.func <funcidx>
      const name = this.names.func(this.r.readU32());
      this.r.readU8(); // 0x0b end
      return name;
    }
    if (opcode === 0xd0) {
      // ref.null <heaptype>. Our element model (`data: string[]`) cannot
      // represent an empty (null) table slot. Silently omitting it shifted
      // every later entry down one table index, so `call_indirect` reached the
      // wrong function (or trapped). Fail loudly until null slots are
      // representable.
      this.r.error(
        'unsupported element segment: a ref.null entry cannot be represented in the table model',
      );
    }
    return this.r.error(
      `unsupported element-segment expression opcode 0x${opcode.toString(16)}`,
    );
  }

  private readCodeSection(): void {
    const count = this.r.readU32();
    const ctx: DecoderCtx = {
      funcTypes: this.funcTypes,
      heapTypeDefs: this.heapTypeDefs,
      importedFuncCount: this.importedFuncCount,
      importedFuncTypeIndices: this.importedFuncTypeIndices,
      funcTypeIndices: this.funcTypeIndices,
      globalInfos: this.globalInfos,
      tableNames: this.tableNames,
      tagInfos: this.tagInfos,
      tagParams: this.tagParams,
      lowerBlockParams: this.lowerBlockParams,
      names: this.names,
    };
    for (let i = 0; i < count; i++) {
      const bodySize = this.r.readU32();
      const bodyStart = this.r.position;
      const bodyEnd = bodyStart + bodySize;
      const funcIdx = this.importedFuncCount + i;
      const typeIdx = this.funcTypeIndices[i];
      const ft = funcTypeAt(this.funcTypes, typeIdx, this.r, `function body ${i}`);
      const bodyReader = this.r.slice(bodyStart, bodyEnd);
      const fn = this.decodeFunction(bodyReader, ft, funcIdx, ctx);
      this.builder.addFunction(
        fn.name,
        fn.params,
        fn.results,
        fn.body,
        fn.locals.slice(fn.params.length),
        fn.bodyFrameLabel,
        fn.locals.slice(0, fn.params.length).map((l) => l.name),
      );
      this.r.seek(bodyEnd);
    }
  }

  private readDataSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      const segKind = this.r.readU32();
      if (segKind === 0) {
        const offset = this.readInitExpr(ValType.I32);
        const dataLen = this.r.readU32();
        const data = this.r.readBytes(dataLen);
        this.builder.addDataSegment(this.names.data(i), offset, data);
      } else if (segKind === 1) {
        // passive
        const dataLen = this.r.readU32();
        const data = this.r.readBytes(dataLen);
        this.builder.addPassiveDataSegment(this.names.data(i), data);
      } else {
        // active with explicit memory index (kind=2)
        const segMemory = this.r.readU32();
        const offset = this.readInitExpr(ValType.I32);
        const dataLen = this.r.readU32();
        const data = this.r.readBytes(dataLen);
        this.builder.addDataSegment(this.names.data(i), offset, data, segMemory);
      }
    }
  }

  private readTagSection(): void {
    const count = this.r.readU32();
    for (let i = 0; i < count; i++) {
      this.r.readU8(); // reserved attribute byte (must be 0)
      const typeIdx = this.r.readU32();
      const ft = funcTypeAt(this.funcTypes, typeIdx, this.r, `tag ${this.tagInfos.length}`);
      this.tagInfos.push({
        name: this.names.tag(this.importedTagCount + this.tagInfos.length),
        params: ft.params,
      });
      this.tagParams.push(ft.params);
    }
  }

  /**
   * Collect the section, with the position it held (C3).
   *
   * 🔧 This read the name and threw the section away, so a decode → encode
   * dropped `producers`, `target_features`, `dylink.0` and DWARF outright.
   *
   * The `name` section is recorded as a PLACE only (`data: null`): its content
   * is regenerated from the names, which passes may have changed. A module with
   * two of them keeps the last place, because the names come from the last
   * section (`findNameSection`) and one section is written back, as upstream
   * binaryen does.
   */
  private readCustomSection(_start: number, end: number): void {
    if (this.r.position >= end) return;
    const nameLen = this.r.readU32();
    if (this.r.position + nameLen > end) {
      this.r.seek(end);
      return;
    }
    const name = this.r.readUTF8(nameLen);
    if (name === 'name') {
      if (this.nameSectionAt !== null) this.customSections.splice(this.nameSectionAt, 1);
      this.nameSectionAt = this.customSections.length;
      this.customSections.push({ name, data: null, precedingSection: this.lastKnownSection });
    } else {
      this.customSections.push({
        name,
        data: this.r.readBytes(end - this.r.position),
        precedingSection: this.lastKnownSection,
      });
    }
    this.r.seek(end);
  }

  private readInitExpr(_expectedType: ValueType): Expression {
    const opcode = this.r.readU8();
    let expr: Expression;
    switch (opcode) {
      case 0x41:
        expr = makeI32Const(this.r.readI32());
        break;
      case 0x42:
        expr = makeI64Const(this.r.readI64());
        break;
      case 0x43:
        expr = makeF32ConstBits(this.r.readF32Bits());
        break;
      case 0x44:
        expr = makeF64ConstBits(this.r.readF64Bits());
        break;
      case 0x23: { // global.get
        const idx = this.r.readU32();
        expr = makeGlobalGet(
          varName(this.names.global(idx)),
          globalTypeAt(this.globalInfos, idx, this.r),
        );
        break;
      }
      case 0xd0: { // ref.null
        expr = makeRefNull(readRefNullType(this.r));
        break;
      }
      case 0xd2: { // ref.func
        const idx = this.r.readU32();
        expr = makeRefFunc(varName(this.names.func(idx)));
        break;
      }
      default:
        // Unknown init-expression opcode. A silent `i32.const 0` here both
        // mis-valued the global/offset AND left the operand bytes unconsumed,
        // desyncing the reader for the rest of the section. Fail loudly.
        this.r.error(`unsupported init-expression opcode: 0x${opcode.toString(16)}`);
    }
    this.r.readU8(); // 0x0b end
    return expr;
  }

  private decodeFunction(
    r: BinaryReader,
    ft: FuncType,
    funcIdx: number,
    ctx: DecoderCtx,
  ): WasmFunction {
    // Read locals
    const locals: Local[] = ft.params.map((t) => ({ type: t }));
    const localGroupCount = r.readU32();
    for (let i = 0; i < localGroupCount; i++) {
      const n = r.readU32();
      const t = readValTypeByte(r);
      for (let j = 0; j < n; j++) locals.push({ type: t });
    }
    // Params and locals share one index space, as the name section's local
    // subsection does. An index past the end names nothing.
    for (const [i, name] of ctx.names.locals(funcIdx)) {
      const local = locals[i];
      if (local !== undefined) local.name = name;
    }

    const frames: ControlFrame[] = [];
    let labelIdx = 0;
    // The name section numbers labels by every block / loop / if / try /
    // try_table in BINARY order — which is decode order here. The function frame
    // and the br_table trampoline's synthetic blocks are not in that count.
    let binaryLabelIdx = 0;

    // A made-up label, clear of every label the section gives this function.
    const freshLabel = (): string => ctx.names.freshLabel(funcIdx, `$l${funcIdx}_${labelIdx++}`);
    // A label-introducing instruction's label: the section's, else a made-up one.
    const instrLabel = (): string => {
      const fresh = freshLabel();
      return ctx.names.label(funcIdx, binaryLabelIdx++) ?? fresh;
    };

    frames.push({
      kind: 'func',
      label: freshLabel(),
      resultTypes: ft.results,
      exprs: [],
    });

    const push = (e: Expression): void => {
      topFrame(frames, r).exprs.push(e);
    };

    const pop = (): Expression => {
      const exprs = topFrame(frames, r).exprs;
      // The operand stack and the statement list share one array. A value
      // consumer must pop the topmost *value-producing* expression — not a
      // `none`-typed statement (nop / local.set / store / void call) that the
      // producer happens to sit beneath. wasic emits exactly this shape in
      // catch handlers: `catch $tag; nop; nop; local.set N` binds a tag param,
      // where the `nop`s carry no stack value and the real value is the catch's
      // `Pop`. Grabbing the `nop` as the operand produces `local.set(nop)`,
      // which CoalesceLocals rewrites to `drop(nop)` and Vacuum then deletes —
      // silently dropping the consumption of a real stack value and leaving the
      // catch's pushed params dangling at the function tail. Skipping `none`
      // statements (leaving them in place so their side effects are preserved)
      // lets the consumer reach the real `Pop`. In well-formed straight-line
      // code values are always on top, so this is a no-opcode there.
      for (let i = exprs.length - 1; i >= 0; i--) {
        if (exprs[i]!.type !== None) { // bounded by the loop header
          // A `Pop` is a stack PLACEHOLDER (a multi-value call's extra result or
          // a catch's exception param) that encodes to NOTHING — it must be
          // consumed in place, never spilled (`local.set (pop)` would leave the
          // set with no stack value). Splice it directly, as before.
          if (i === exprs.length - 1 || exprs[i]!.kind === 'pop') {
            return exprs.splice(i, 1)[0]!;
          }
          // The value sits BELOW ≥1 statement. Returning it directly would move
          // it AFTER those statements in the reconstructed tree — CORRECT only
          // if the value can't observe their effects. It's WRONG when the value
          // reads mutable state a skipped statement writes: e.g. the TinyGo
          // goroutine trampoline keeps the caller's `$__stack_pointer`
          // (`global.get`) live on the operand stack across
          // `global.set $__stack_pointer …; call_indirect; call`, then a trailing
          // `global.set $__stack_pointer` consumes it to RESTORE it. Re-evaluating
          // `global.get $__stack_pointer` at that later point yields the callee's
          // (already-overwritten) value → `global.set(global.get)` self-assign,
          // which never restores the shadow stack and corrupts every later
          // allocation. Spill the value into a fresh temp AT ITS ORIGINAL
          // POSITION and read it back — exactly what the source's own local did —
          // so evaluation order is preserved. (A later CoalesceLocals/Vacuum pass
          // elides the temp where it turns out to be reorder-safe.)
          const val = exprs[i]!;
          const tmp = locals.length;
          locals.push({ type: val.type as ValType });
          exprs[i] = makeLocalSet(varIndex(tmp), val);
          return makeLocalGet(varIndex(tmp), val.type as ValType);
        }
      }
      // No value-producing expression in this frame at all. That is legal in
      // exactly one situation: STACK-POLYMORPHIC code. After `unreachable` (or
      // `br` / `return` / `throw`) the validator lets an instruction pop values
      // that were never pushed, and the phantom it pops is of the bottom type.
      // `unreachable` IS that value; a `nop` is not a value at all.
      //
      // Returning `makeNop()` here (as this did) put a `none`-typed statement
      // in an operand position — the same defect class as the catch-param and
      // tuple-call `nop`s above, and it round-tripped unstably: the upstream
      // fixture `unreachable-pops.wasm`
      // (`block (result i32); unreachable; i32.add`) decoded to
      // `i32.add(nop, unreachable)`, re-encoded with a spurious leading `nop`
      // opcode, and grew an expression on every trip. Upstream decodes the same
      // bytes as `(i32.add (unreachable) (unreachable))`, which is what this
      // now produces — and it is a fixed point.
      //
      // If the frame is genuinely reachable this input is malformed; an
      // `unreachable`-typed operand then surfaces as a validation failure
      // downstream instead of a silently-wrong `nop`.
      return makeUnreachable();
    };

    const popN = (n: number): Expression[] => {
      const result: Expression[] = [];
      for (let i = 0; i < n; i++) result.unshift(pop());
      return result;
    };

    // Push a call that may return multiple (tuple) results. The binary pushes
    // N values onto the operand stack, but the IR models the call as a single
    // node — so for N > 1 results each of the OTHER N-1 values needs its own
    // value-typed representative or the consumers that pop them (a `local.set`
    // per result, in the wasic spill pattern) grab a `nop`/void statement
    // instead. That mirrors the catch-param defect (WT-2h): `local.set(nop)`
    // becomes `drop(nop)` under CoalesceLocals and Vacuum then deletes the
    // consumption, dangling the value at the function tail. Seed N-1 typed
    // `Pop`s BELOW the call node (so the call — which carries the operands and
    // must encode first — is consumed first, emitting the actual `call`
    // opcode; each later consumer then pops a `Pop`, which encodes to nothing
    // and survives optimization as `drop(pop)`). `results[i]` types the Pop
    // for the value the i-th later consumer pops.
    /**
     * Moves a parametrised block's entry values into fresh locals and returns
     * the reads that seed the inner frame's operand stack.
     *
     * A block with `(param t0 .. tN)` pops N values from the ENCLOSING stack on
     * entry; inside, they are the first things on its own stack. `BlockExpr` has
     * no parameter list to hold them, so instead each value is evaluated exactly
     * once into a fresh local BEFORE the block (a `local.set` appended to the
     * enclosing frame), and the block body reads them back. That is semantically
     * identical — entering a block has no observable effect — and it keeps the
     * evaluation ORDER intact, which simply relocating the value expressions
     * into the body would not for an `if` (both arms would re-evaluate them).
     *
     * The temporaries are ordinary locals, so `SimplifyLocals` / `CoalesceLocals`
     * fold most of them away again.
     */
    const spillBlockParams = (
      params: ValueType[],
    ): { reads: Expression[]; slots: number[] } => {
      if (params.length === 0) return { reads: [], slots: [] };
      const vals: Expression[] = [];
      for (let i = 0; i < params.length; i++) vals.unshift(pop());
      const reads: Expression[] = [];
      const slots: number[] = [];
      // `vals` was filled with exactly `params.length` entries on the line above,
      // so `vals[i]!` is bounded by the loop it shares with `params`.
      for (const [i, ptype] of params.entries()) {
        const tmp = locals.length;
        locals.push({ type: ptype });
        slots.push(tmp);
        push(makeLocalSet(varIndex(tmp), vals[i]!));
        reads.push(makeLocalGet(varIndex(tmp), ptype));
      }
      return { reads, slots };
    };

    /**
     * A construct's entry, for parameter types `types`: what its region starts
     * with, the parameters to keep on the node, and — when lowering — the spill
     * slots.
     *
     * By default (S6 decision 7b(i)) the entry values are popped into the
     * node's `params` and the region is seeded with one `Pop` per type, exactly
     * as a `catch` is seeded with its tag's values: nothing moves, and the
     * construct re-encodes as written. With `lowerBlockParams` the values are
     * spilled to locals and the region reads them back — `spillBlockParams`,
     * the IR every pass expects.
     */
    const enterParams = (
      types: ValueType[],
    ): { seed: Expression[]; params?: BlockParams; slots: number[] } => {
      if (types.length === 0) return { seed: [], slots: [] };
      if (ctx.lowerBlockParams) {
        const { reads, slots } = spillBlockParams(types);
        return { seed: reads, slots };
      }
      return {
        seed: types.map((t) => makePop(t)),
        params: { types: [...types], values: popN(types.length) },
        slots: [],
      };
    };

    /**
     * The header's written type index, where keeping it is SAFE (7c).
     *
     * 🔧 Recording it unconditionally broke every lowered block-parameter case:
     * the index names a type WITH parameters, and after `lowerBlockParams` the
     * construct no longer takes any, so the header re-declared inputs nothing
     * supplied — "not enough arguments on the stack for loop". The index is only
     * the node's own type while the node still has that signature.
     */
    const writtenIndex = (
      sig: BlockSignature,
      entry: { params?: BlockParams },
    ): { typeIndex?: number } =>
      sig.typeIndex !== undefined && (sig.params.length === 0 || entry.params !== undefined)
        ? { typeIndex: sig.typeIndex }
        : {};

    /** `node`, given the frame's kept parameters when it has any. */
    const withParams = <T extends { params?: BlockParams; typeIndex?: number }>(
      node: T,
      frame: ControlFrame,
    ): T => {
      if (frame.params !== undefined) node.params = frame.params;
      // The header's written form: an index where an inline value type would
      // have done (7c). Only the CHOICE is unrecoverable — the signature is on
      // the node either way.
      if (frame.typeIndex !== undefined) node.typeIndex = frame.typeIndex;
      return node;
    };

    /**
     * Rewrites a branch whose target is a parametrised LOOP.
     *
     * The loop's parameters have become locals, so a back-edge must WRITE those
     * locals and then branch carrying nothing. Two forms:
     *
     * `br $loop`  →  `local.set $t0 v0; …; br $loop`
     *
     * `br_if $loop` →
     * ```
     *   local.set $t0 v0; … ;   ;; values evaluated once, into the loop's temps
     *   br_if $loop (cond)      ;; loop takes no values now
     *   local.get $t0; …        ;; NOT TAKEN: put them back on the stack
     * ```
     * That trailing restore is the whole reason loop inputs were rejected: a
     * `br_if` that is not taken leaves its values on the operand stack, so
     * writing the temps unconditionally without pushing them back would strip
     * them from the fall-through path — a silent wrong-value miscompile.
     *
     * Evaluation order is preserved: the values were evaluated before the
     * condition in the input, and the emitted `local.set`s precede the branch
     * that carries the condition.
     */
    const rewriteLoopBranch = (
      target: ControlFrame,
      label: string,
      cond: Expression | null,
      switchTargets?: string[],
      switchIndex?: Expression,
    ): void => {
      const slots = target.paramLocals!;
      const types = target.paramTypes!;
      // The two are written together when the frame is seeded, so a mismatch is
      // an internal invariant break rather than bad input — but the reads below
      // pair them by index, and pairing two lists of different lengths silently
      // builds a `local.get` with an undefined type. Check once, index freely.
      if (slots.length !== types.length) {
        r.error(
          `loop parameter seed is inconsistent: ${slots.length} slots, ${types.length} types`,
        );
      }
      const vals: Expression[] = [];
      for (let i = 0; i < slots.length; i++) vals.unshift(pop());
      for (const [i, slot] of slots.entries()) push(makeLocalSet(varIndex(slot), vals[i]!));
      if (switchTargets !== undefined) {
        // `br_table` where every target is this same loop: one set of temps,
        // then a value-less table.
        push(makeSwitch(switchTargets, label, switchIndex!));
        return;
      }
      push(makeBreak(label, cond));
      if (cond !== null) {
        for (const [i, slot] of slots.entries()) push(makeLocalGet(varIndex(slot), types[i]!));
      }
    };

    /**
     * Rewrites a `br_table` whose targets MIX a parametrised loop with other
     * frames, by replacing the single table with a dispatch trampoline.
     *
     * After loop parameters become locals the two kinds of target disagree on
     * calling convention: a parametrised loop consumes 0 stack values and wants
     * its temps written, while a block / `if` / function target still consumes
     * its arity from the stack. No single `br_table` satisfies both. So the
     * table is demoted to selecting a CASE, and each case then branches its own
     * way:
     *
     * ```wat
     * local.set $i                  ;; index
     * local.set $s0 …               ;; the N values, into SHARED temps
     * block $L0
     *   block $L1
     *     block $L2
     *       local.get $i
     *       br_table $L0 $L1 $L2    ;; every case label is void
     *     end
     *     <case 2>                  ;; lands here on falling out of $L2
     *   end
     *   <case 1>
     * end
     * <case 0>
     * ```
     *
     * Each case is one unconditional branch, so no case falls through into the
     * next and every wrapper block is void.
     *
     * Order is preserved: the values are stored before the index, matching the
     * input where the values are pushed before the table's operand.
     */
    const buildBrTableTrampoline = (
      targetFrames: (ControlFrame | undefined)[],
      labels: string[],
      index: Expression,
      arity: number,
      types: ValueType[],
    ): void => {
      // Shared temps for the N branch values, filled once.
      const vals: Expression[] = [];
      for (let i = 0; i < arity; i++) vals.unshift(pop());
      const shared: number[] = [];
      for (let i = 0; i < arity; i++) {
        const tmp = locals.length;
        locals.push({ type: types[i]! });
        shared.push(tmp);
        push(makeLocalSet(varIndex(tmp), vals[i]!)); // both filled to `arity` above
      }
      const idxSlot = locals.length;
      locals.push({ type: ValType.I32 });
      push(makeLocalSet(varIndex(idxSlot), index));

      /** The branch a single case performs, in that target's own convention. */
      const caseCode = (frame: ControlFrame | undefined, label: string): Expression[] => {
        if (frame?.paramLocals?.length) {
          const slots = frame.paramLocals;
          // `slots` belongs to the TARGET frame; `shared`/`types` are sized by the
          // table's arity. The spec requires every `br_table` label to share the
          // default's arity, so these agree for any valid module — but pairing
          // them by index without checking meant a malformed table silently
          // produced `local.get undefined` rather than a diagnostic.
          if (slots.length !== arity) {
            r.error(
              `br_table target arity ${slots.length} does not match the table arity ${arity}`,
            );
          }
          const out: Expression[] = slots.map((slot, i) =>
            makeLocalSet(varIndex(slot), makeLocalGet(varIndex(shared[i]!), types[i]!))
          );
          out.push(makeBreak(label));
          return out;
        }
        const reads = shared.map((slot, i) => makeLocalGet(varIndex(slot), types[i]!));
        return [makeBreak(label, null, reads)];
      };

      // One wrapper block per case; `caseLabels[j]` is exited to reach case j.
      //
      // 🔧 Each wrapper is DECLARED `none`. `makeBlock` infers from the last
      // child — here the `br_table`, or a case's closing `br` — which typed
      // every wrapper `unreachable`. But each is a branch TARGET, so its end is
      // reachable (upstream `Block::finalize` checks for branches; inference
      // cannot). DCE trusted the type and deleted every case after the first
      // wrapper: any -O level turned the valid module invalid ("expected 1
      // elements on the stack for fallthru"). Found when S6 decision 7b(i)'s
      // tests ran each parametrised fixture through the optimizer — no test
      // had ever optimized a trampoline.
      const caseLabels = labels.map(() => freshLabel());
      const last = caseLabels.length - 1;

      let node: Expression = makeBlock(
        [makeSwitch(
          caseLabels.slice(0, last),
          caseLabels[last]!,
          makeLocalGet(varIndex(idxSlot), ValType.I32),
        )],
        caseLabels[last],
        None,
      );
      for (let j = last - 1; j >= 0; j--) {
        node = makeBlock(
          [node, ...caseCode(targetFrames[j + 1], labels[j + 1]!)],
          caseLabels[j]!,
          None,
        );
      }
      push(node);
      for (const e of caseCode(targetFrames[0], labels[0]!)) push(e);
    };

    /** The target frame of a branch, or `undefined` if the depth escapes. */
    const branchTarget = (depth: number): ControlFrame | undefined =>
      frames[frames.length - 1 - depth];

    const pushMultiValueCall = (call: Expression, results: ValueType[]): void => {
      for (let i = 0; i < results.length - 1; i++) push(makePop(results[i]!));
      push(call);
    };

    decode: while (!r.eof) {
      const opcode = r.readU8();
      switch (opcode) {
        case 0x00:
          push(makeUnreachable());
          break;
        case 0x01:
          push(makeNop());
          break;

        case 0x02: { // block
          const sig = readBlockType(r, ctx.funcTypes);
          const entry = enterParams(sig.params);
          frames.push({
            kind: 'block',
            label: instrLabel(),
            resultTypes: sig.results,
            exprs: entry.seed,
            ...(entry.params ? { params: entry.params } : {}),
            ...writtenIndex(sig, entry),
          });
          break;
        }
        case 0x03: { // loop
          const sig = readBlockType(r, ctx.funcTypes);
          // What makes a LOOP different is that every back-edge branch
          // re-supplies its parameters: kept, a branch carries them as values;
          // lowered, the temps are recorded for `rewriteLoopBranch` to find.
          const entry = enterParams(sig.params);
          frames.push({
            kind: 'loop',
            label: instrLabel(),
            resultTypes: sig.results,
            exprs: entry.seed,
            paramLocals: entry.slots,
            paramTypes: [...sig.params],
            ...(entry.params ? { params: entry.params } : {}),
            ...writtenIndex(sig, entry),
          });
          break;
        }
        case 0x04: { // if
          const sig = readBlockType(r, ctx.funcTypes);
          // Pop the CONDITION first: it sits above the parameters on the stack.
          const cond = pop();
          const entry = enterParams(sig.params);
          const types = [...sig.params];
          const slots = entry.slots;
          frames.push({
            kind: 'if',
            label: instrLabel(),
            resultTypes: sig.results,
            exprs: entry.seed,
            ifCondition: cond,
            thenExprs: [],
            // Both arms start with the same parameters on their stack — the
            // values were evaluated ONCE, before the `if`.
            seedElse: entry.params
              ? () => types.map((t) => makePop(t))
              : () => slots.map((slot, i) => makeLocalGet(varIndex(slot), types[i]!)),
            ...(entry.params ? { params: entry.params } : {}),
            ...writtenIndex(sig, entry),
          });
          break;
        }
        case 0x05: { // else
          const frame = topFrame(frames, r);
          if (frame.kind === 'if') {
            frame.thenExprs = frame.exprs;
            // Re-seed, do not re-evaluate: fresh nodes, never the then-arm's.
            frame.exprs = frame.seedElse?.() ?? [];
            frame.kind = 'else' as ControlFrameKind;
          } else {
            // `else` outside an `if` used to fall through this `if` and vanish:
            // the opcode was consumed and nothing happened, so the instructions
            // that followed kept accumulating into the enclosing frame and the
            // module decoded as a DIFFERENT program with no diagnostic.
            r.error(`else outside an if (enclosing frame is ${frame.kind})`);
          }
          break;
        }

        case 0x06: { // try (old EH)
          // A `try`'s parameters are supplied on ENTRY only — a branch to its
          // label targets its END (results), and catch handlers start with the
          // TAG's parameters, not the try's. So the plain `block` spill applies
          // and only the try BODY is seeded.
          const trySig = readBlockType(r, ctx.funcTypes);
          const entry = enterParams(trySig.params);
          const rts = trySig.results;
          frames.push({
            kind: 'try',
            label: instrLabel(),
            resultTypes: rts,
            exprs: entry.seed,
            catchTags: [],
            catchBodies: [],
            delegateTarget: null,
            ...(entry.params ? { params: entry.params } : {}),
            ...writtenIndex(trySig, entry),
          });
          break;
        }
        case 0x07: { // catch $tag (old EH)
          const tagIdx = r.readU32();
          const tagName = ctx.names.tag(tagIdx);
          const tagParams = tagParamsAt(ctx, tagIdx, r);
          const frame = topFrame(frames, r);
          if (frame.kind === 'try' || frame.kind === 'catch') {
            // save current body
            if (frame.kind === 'try') {
              frame.tryBody = frame.exprs;
            } else {
              frame.catchBodies!.push(frame.exprs);
            }
            // `catch $tag` pushes the tag's params onto the catch region's
            // operand stack. Seed the new body with one `Pop` per param (in
            // param order, so the last param is on top and consumed first) —
            // one I32 Pop is wrong for multi-param or non-I32 tags, and the
            // body's binding instructions (`local.set`, `drop`, ...) must each
            // consume a real `Pop` so the consumption survives optimization.
            frame.exprs = tagParams.map((p) => makePop(p));
            frame.catchTags!.push(varName(tagName));
            frame.kind = 'catch' as ControlFrameKind;
          } else {
            // Same silent drop as `else` above: the tag index was consumed and the
            // handler transition never happened.
            r.error(`catch outside a try (enclosing frame is ${frame.kind})`);
          }
          break;
        }
        case 0x08: { // throw $tag
          const tagIdx = r.readU32();
          const tagName = ctx.names.tag(tagIdx);
          const tagParams = tagParamsAt(ctx, tagIdx, r);
          const operands = popN(tagParams.length);
          push(makeThrow(varName(tagName), operands));
          break;
        }
        case 0x09: { // rethrow $depth (old EH)
          const depth = r.readU32();
          push(makeRethrow(resolveLabel(frames, depth)));
          break;
        }
        case 0x0a: { // throw_ref (new EH)
          push(makeThrowRef(pop()));
          break;
        }

        case 0x0b: { // end
          if (topFrame(frames, r).kind === 'func') {
            break decode; // leave func frame on stack for body assembly
          }
          const frame = popFrame(frames, r);
          const rts = frame.resultTypes;
          const resultType: Type = resultTypeOf(rts);
          if (frame.kind === 'if' || frame.kind === 'else') {
            const cond = frame.ifCondition!;
            // Pivot on whether the `else` opcode (0x05) was seen for this frame:
            //   * `"if"`   — no else; `frame.exprs` IS the then-arm body, and
            //                there is no else arm.
            //   * `"else"` — else seen; `frame.thenExprs` was snapshotted by
            //                the else handler, and `frame.exprs` is the else-arm.
            // The previous unified `thenBlock = frame.thenExprs ?? []` path
            // silently put a single-arm `if`'s body in the ELSE arm (because
            // `frame.thenExprs` only ever got assigned in the else handler), so
            // a round-tripped `(if cond (then BODY))` ran BODY when cond was
            // FALSE — the wasmtk team reported four real test failures driven
            // by this on wasic-emitted single-arm ifs (break conditions, bounds
            // checks, null guards).
            const thenExprs = frame.kind === 'if' ? frame.exprs : (frame.thenExprs ?? []);
            const elseExprs = frame.kind === 'if' ? [] : frame.exprs;
            const thenExpr = makeRegion(thenExprs);
            const elseExpr = frame.kind === 'else' ? makeRegion(elseExprs) : null;
            // Pass `frame.label` so a `br` that targets this `if` (resolved to
            // this label at decode time) round-trips to the correct branch
            // depth on encode. Without it the encoder pushed an empty label and
            // the branch silently resolved to the wrong (innermost) frame.
            // ⚠️ The DECLARED result type wins over the inferred one.
            //
            // `makeIf` infers the type from its arms, and `void resultType;`
            // used to discard what the binary actually said. That is right up
            // until both arms are UNREACHABLE — then there is nothing to infer
            // from, the `if` comes out void, and the value the caller expects is
            // simply absent: *"expected 0 elements on the stack for fallthru,
            // found 1"*. Found by re-encoding a Go-compiled binary from the
            // wasmtk suite, which no corpus module exercises.
            //
            // The binary always carries the blocktype, so the declared type is
            // never a guess here. This is the same reconciliation the bridge
            // does with `withDeclaredType`, and the same fact `cmem/ir-convergence.md`
            // records as the most load-bearing member of the as-written set.
            //
            // 🔧 A VOID `if` too. It was left to inference, so one whose arms both
            // end unreachable came out typed `unreachable` — but wasm validates
            // it against its declared type, and after its `end` the stack is
            // empty, not polymorphic. DCE read the IR type and deleted the value
            // the enclosing block still needed (-Oz failed 30 of the 70 legacy
            // EH spec assertions; `unreachable_construct.test.ts`).
            const ifExpr = makeIf(cond, thenExpr, elseExpr, frame.label);
            // Every multi-result carrier seeds its extra values' `Pop`s, not only
            // `block` below: pushed bare, a later consumer's second pop found
            // nothing and took `unreachable` (`multivalue_constructs.test.ts`).
            pushMultiValueCall(withParams({ ...ifExpr, type: resultType }, frame), rts);
          } else if (frame.kind === 'loop') {
            const body = sealFrame(frame);
            pushMultiValueCall(withParams(makeLoop(frame.label, body, resultType), frame), rts);
          } else if (frame.kind === 'try' || frame.kind === 'catch') {
            const tryBodyExprs = frame.kind === 'try' ? frame.exprs : (frame.tryBody ?? []);
            const tryBody = makeRegion(tryBodyExprs);
            const allCatchBodies = [...(frame.catchBodies ?? [])];
            if (frame.kind === 'catch') allCatchBodies.push(frame.exprs);
            const tags = frame.catchTags ?? [];
            // Zip here, once, where both halves are in hand. The IR holds
            // clauses, so a tag without a body cannot leave this function.
            const catches = allCatchBodies.map((body, i) => ({
              ...(tags[i] === undefined ? {} : { tag: tags[i]! }),
              isRef: false,
              body: makeRegion(body),
            }));
            pushMultiValueCall(
              withParams(makeTry(frame.label, tryBody, catches, null, resultType), frame),
              rts,
            );
          } else if (frame.kind === 'try_table') {
            const body = sealFrame(frame);
            pushMultiValueCall(
              withParams(
                makeTryTable(frame.label, body, frame.tryCatches ?? [], resultType),
                frame,
              ),
              rts,
            );
          } else {
            // block (only remaining kind here — func/if/else/loop/try*
            // were handled above).
            //
            // `makeBlock` infers `.type` from the last child, which is wrong
            // when the body exits via `br` (last child is the Break, whose
            // own type is always `None`). We trust the frame's declared
            // result type instead — it came from the `0x02 RESULTTYPE` byte.
            if (frame.exprs.length === 0 && !frame.label) {
              push(makeNop());
            } else {
              const blk = withParams(makeBlock(frame.exprs, frame.label, resultType), frame);
              // A multi-result block leaves N values on the enclosing operand
              // stack, but the IR models it as ONE node. Seed N-1 typed `Pop`s
              // beneath it so each later consumer has its own value-typed
              // representative — the same shape `pushMultiValueCall` uses for a
              // tuple-returning call. Without this the extra results are
              // invisible and later consumers grab a statement instead.
              pushMultiValueCall(blk, rts);
            }
          }
          break;
        }

        case 0x0c: { // br
          const depth = r.readU32();
          // A br consumes the target block's result values from the operand
          // stack. For a `loop`, branching jumps to the loop entry (and in
          // MVP loops have no inputs, so nothing is consumed). For
          // `block`/`if`/`try`/etc., it consumes the target's result types.
          // A branch to a multi-result target carries N values, held as a list.
          // This used to pop NOTHING for N > 1 and emit a value-less break,
          // silently discarding every value the branch carried.
          const brTarget = branchTarget(depth);
          if (brTarget?.paramLocals?.length) {
            rewriteLoopBranch(brTarget, resolveLabel(frames, depth), null);
            break;
          }
          const values = _branchValues(frames, depth, pop);
          push(makeBreak(resolveLabel(frames, depth), null, values));
          break;
        }
        case 0x0d: { // br_if
          const depth = r.readU32();
          // br_if stack order: ..., value, condition. Pop condition first.
          const cond = pop();
          const brIfTarget = branchTarget(depth);
          if (brIfTarget?.paramLocals?.length) {
            rewriteLoopBranch(brIfTarget, resolveLabel(frames, depth), cond);
            break;
          }
          const values = _branchValues(frames, depth, pop);
          push(makeBreak(resolveLabel(frames, depth), cond, values));
          break;
        }
        case 0x0e: { // br_table
          const n = r.readU32();
          const depths: number[] = [];
          for (let i = 0; i <= n; i++) depths.push(r.readU32());
          const defaultDepth = depths.pop()!;
          // br_table stack order: ..., value, index. Pop index first, then
          // value if any target has results (all targets must share arity).
          const cond = pop();
          // `br_table` picks its target at RUNTIME, so a parametrised loop among
          // the targets can be rewritten in place only when EVERY target is that
          // same loop — then there is one unambiguous set of temps to write.
          //
          // Mixed targets cannot be served by a single table once the loop's
          // parameters have become locals: the loop now consumes 0 stack values
          // while a block/function target still consumes its own arity, so no
          // one instruction satisfies both. They get a per-target dispatch
          // trampoline instead (`buildBrTableTrampoline`).
          //
          // 🔧 This comment used to open by saying such tables were "rare enough
          // to reject outright", and to close with "rejected rather than
          // approximated" — both from before the trampoline existed.
          const tableTargets = [...depths, defaultDepth].map(branchTarget);
          const paramLoopTargets = tableTargets.filter((t) => t?.paramLocals?.length);
          if (paramLoopTargets.length > 0) {
            const allSame = tableTargets.every((t) => t === tableTargets[0]);
            const labels = [...depths, defaultDepth].map((d) => resolveLabel(frames, d));
            if (allSame) {
              // Every case is the SAME loop: one unambiguous set of temps, then
              // a value-less table. No trampoline needed.
              rewriteLoopBranch(
                tableTargets[0]!,
                labels[labels.length - 1]!,
                null,
                labels.slice(0, -1),
                cond,
              );
              break;
            }
            // Mixed targets: the loop wants its temps written, the others want
            // values on the stack. Dispatch per case.
            const ref = tableTargets[tableTargets.length - 1] ?? tableTargets[0];
            const tTypes = ref?.paramLocals?.length ? ref.paramTypes! : (ref?.resultTypes ?? []);
            buildBrTableTrampoline(tableTargets, labels, cond, tTypes.length, tTypes);
            break;
          }
          const values = _branchValues(frames, defaultDepth, pop);
          const targets = depths.map((d) => resolveLabel(frames, d));
          const defaultTarget = resolveLabel(frames, defaultDepth);
          push(makeSwitch(targets, defaultTarget, cond, values));
          break;
        }
        case 0x0f: { // return
          // 🔧 Pops one value PER RESULT. It popped exactly one whenever the
          // function had any result, so a multi-value `return` left the other
          // values behind as loose statements beside it (`[const 1,
          // return(const 2)]`). The bytes re-encoded identically, which is why
          // no round trip saw it; any pass free to move or drop a loose value
          // could have broken it.
          push(makeReturn(_popValues(ft.results.length, pop)));
          break;
        }
        case 0x10: { // call
          const fidx = r.readU32();
          const typeIdx = fidx < ctx.importedFuncCount
            ? ctx.importedFuncTypeIndices[fidx]
            : ctx.funcTypeIndices[fidx - ctx.importedFuncCount];
          const cft = funcTypeAt(ctx.funcTypes, typeIdx, r, `call ${fidx}`);
          const operands = popN(cft.params.length);
          const resultType: Type = resultTypeOf(cft.results);
          pushMultiValueCall(
            makeCall(varName(ctx.names.func(fidx)), operands, resultType),
            cft.results,
          );
          break;
        }
        case 0x11: { // call_indirect
          const typeIdx = r.readU32();
          const tidx = r.readU32();
          const cft = funcTypeAt(ctx.funcTypes, typeIdx, r, 'call_indirect');
          const target = pop();
          const operands = popN(cft.params.length);
          // Discarding the table index and hard-coding table 0 silently retargeted
          // an indirect call in a multi-table module — the element-segment and
          // `table.get`/`table.set` decoders were already index-aware, this one
          // was not. The encoder happens to reject >1 table today, so it never
          // reached bytes; parse-only consumers (the bridge, the compat facade's
          // introspection) saw the wrong table with no diagnostic.
          const tableName = ctx.tableNames[tidx] ??
            r.error(`call_indirect table index ${tidx} is out of range`);
          pushMultiValueCall(
            // The index AS WRITTEN (7c): several types may be structurally
            // identical, and deriving one picks the first (T1).
            {
              ...makeCallIndirect(varName(tableName), target, operands, {
                params: cft.params,
                results: cft.results,
              }),
              typeVar: varIndex(typeIdx),
            },
            cft.results,
          );
          break;
        }
        case 0x12: { // return_call (tail-call proposal)
          const fidx = r.readU32();
          const typeIdx = fidx < ctx.importedFuncCount
            ? ctx.importedFuncTypeIndices[fidx]
            : ctx.funcTypeIndices[fidx - ctx.importedFuncCount];
          const cft = funcTypeAt(ctx.funcTypes, typeIdx, r, `call ${fidx}`);
          const operands = popN(cft.params.length);
          const resultType: Type = resultTypeOf(cft.results);
          push(makeCall(varName(ctx.names.func(fidx)), operands, resultType, /* isReturn */ true));
          break;
        }
        case 0x13: { // return_call_indirect (tail-call proposal)
          const typeIdx = r.readU32();
          const tidx = r.readU32();
          const cft = funcTypeAt(ctx.funcTypes, typeIdx, r, 'call_indirect');
          const target = pop();
          const operands = popN(cft.params.length);
          // Discarding the table index and hard-coding table 0 silently retargeted
          // an indirect call in a multi-table module — the element-segment and
          // `table.get`/`table.set` decoders were already index-aware, this one
          // was not. The encoder happens to reject >1 table today, so it never
          // reached bytes; parse-only consumers (the bridge, the compat facade's
          // introspection) saw the wrong table with no diagnostic.
          const tableName = ctx.tableNames[tidx] ??
            r.error(`call_indirect table index ${tidx} is out of range`);
          push({
            ...makeCallIndirect(
              varName(tableName),
              target,
              operands,
              { params: cft.params, results: cft.results },
              /* isReturn */ true,
            ),
            typeVar: varIndex(typeIdx), // as written (7c) — see `call_indirect` above
          });
          break;
        }

        case 0x18: { // delegate $depth (old EH — ends the try without end opcode)
          const depth = r.readU32();
          const frame = popFrame(frames, r);
          // `delegate` terminates a `try`. Applied to any other frame it silently
          // rebuilt that frame as a `try ... delegate` — a plain block came back
          // out as an exception construct.
          if (frame.kind !== 'try') {
            r.error(`delegate outside a try (enclosing frame is ${frame.kind})`);
          }
          const rts = frame.resultTypes;
          const resultType: Type = resultTypeOf(rts);
          const tryBody = makeRegion(frame.exprs);
          pushMultiValueCall(
            withParams(
              makeTry(frame.label, tryBody, [], resolveLabel(frames, depth), resultType),
              frame,
            ),
            rts,
          );
          break;
        }
        case 0x19: { // catch_all (old EH)
          const frame = topFrame(frames, r);
          if (frame.kind === 'try' || frame.kind === 'catch') {
            if (frame.kind === 'try') {
              frame.tryBody = frame.exprs;
            } else {
              frame.catchBodies!.push(frame.exprs);
            }
            frame.exprs = [];
            frame.catchTags!.push(undefined); // absence IS catch_all
            frame.kind = 'catch' as ControlFrameKind;
          } else {
            r.error(`catch_all outside a try (enclosing frame is ${frame.kind})`);
          }
          break;
        }
        case 0x1f: { // try_table blocktype (numHandlers handlers) (new EH)
          // Same as `try`: parameters are entry-only, so seed just the body.
          const ttSig = readBlockType(r, ctx.funcTypes);
          const entry = enterParams(ttSig.params);
          const rts = ttSig.results;
          const numHandlers = r.readU32();
          // Read catch clause data (tag+depth pairs) before pushing frame
          // `tag: Var | undefined`, not `tag?: Var`: this is the decoder's own
          // scratch list, where every entry HAS the slot. The IR's clause is
          // the one that distinguishes absent from present
          // (`exactOptionalPropertyTypes`), and the map below does that.
          const catchData: Array<{ tag: Var | undefined; depth: number; isRef: boolean }> = [];
          for (let i = 0; i < numHandlers; i++) {
            const code = r.readU8();
            let tag: Var | undefined;
            if (code === 0x00 || code === 0x01) { // catch / catch_ref
              const tidx = r.readU32();
              tag = varName(ctx.names.tag(tidx));
            }
            const depth = r.readU32();
            const isRef = code === 0x01 || code === 0x03;
            catchData.push({ tag, depth, isRef });
          }
          // Catch-clause label indices are resolved in the ENCLOSING scope: a
          // try_table's own label is NOT in scope for its own handlers, so
          // depth 0 names the immediately enclosing frame. Resolving them after
          // pushing the frame shifted every handler one frame too deep — a
          // handler meant for the surrounding block pointed at the try_table
          // itself. The encoder pushed the same phantom label, so a round-trip
          // stayed byte-identical and hid it; only the IR — and anything built
          // against it, such as the wabt-ts bridge — saw the wrong target.
          const catches: TableCatch[] = catchData.map(({ tag, depth, isRef }) => ({
            // ABSENT tag means catch_all / catch_all_ref, as the legacy path
            // has always spelled it.
            ...(tag !== undefined ? { tag } : {}),
            target: varName(resolveLabel(frames, depth)),
            isRef,
          }));
          frames.push({
            kind: 'try_table',
            label: instrLabel(),
            resultTypes: rts,
            exprs: entry.seed,
            tryCatches: catches,
            ...(entry.params ? { params: entry.params } : {}),
            ...writtenIndex(ttSig, entry),
          });
          break;
        }

        case 0x1a:
          push(makeDrop(pop()));
          break; // drop
        case 0x1b: { // select
          const cond = pop();
          const b = pop();
          const a = pop();
          push(makeSelect(a, b, cond));
          break;
        }
        case 0x1c: { // select t* — typed select
          // Was not decoded at all ("unknown opcode 0x1c"): a standard
          // instruction since reference types, and the ONLY legal select over
          // references. The declared type wins over the arms' inferred one — a
          // `ref.null` arm infers a narrower type than the select declares —
          // and is kept ON THE NODE (S6 decision 7a), so it survives anything
          // that rebuilds the select and re-encodes as written.
          const count = r.readU32();
          if (count !== 1) r.error(`typed select must declare exactly one type, got ${count}`);
          const declared = readValueType(r);
          const cond = pop();
          const b = pop();
          const a = pop();
          push(makeSelect(a, b, cond, declared));
          break;
        }

        case 0x20: { // local.get
          const idx = r.readU32();
          push(makeLocalGet(varIndex(idx), localTypeAt(locals, idx, r)));
          break;
        }
        case 0x21: { // local.set
          const idx = r.readU32();
          push(makeLocalSet(varIndex(idx), pop()));
          break;
        }
        case 0x22: { // local.tee
          const idx = r.readU32();
          const val = pop();
          push(makeLocalTee(varIndex(idx), val, localTypeAt(locals, idx, r)));
          break;
        }
        case 0x23: { // global.get
          const idx = r.readU32();
          push(
            makeGlobalGet(varName(ctx.names.global(idx)), globalTypeAt(ctx.globalInfos, idx, r)),
          );
          break;
        }
        case 0x24: { // global.set
          const idx = r.readU32();
          push(makeGlobalSet(varName(ctx.names.global(idx)), pop()));
          break;
        }

        case 0x25: { // table.get $t
          const tidx = r.readU32();
          const table = ctx.names.table(tidx);
          const indexExpr = pop();
          push(makeTableGet(varName(table), indexExpr));
          break;
        }
        case 0x26: { // table.set $t
          const tidx = r.readU32();
          const table = ctx.names.table(tidx);
          const value = pop();
          const indexExpr = pop();
          push(makeTableSet(varName(table), indexExpr, value));
          break;
        }

        // Loads (0x28..0x35) and stores (0x36..0x3e). The byte just read IS the
        // node's opcode, so it is passed through rather than re-described as a
        // width/sign/type triple. That re-description is where the i64 narrow
        // stores used to be rotated — decoded as the wrong width, and cancelled
        // by the encoder's inverse rotation (narrow_store_width.test.ts).
        case 0x28:
        case 0x29:
        case 0x2a:
        case 0x2b:
        case 0x2c:
        case 0x2d:
        case 0x2e:
        case 0x2f:
        case 0x30:
        case 0x31:
        case 0x32:
        case 0x33:
        case 0x34:
        case 0x35: {
          const { align, offset, memory } = readMemArg(r);
          push(makeLoad(opcode as Opcode, offset, align, pop(), memory));
          break;
        }
        case 0x36:
        case 0x37:
        case 0x38:
        case 0x39:
        case 0x3a:
        case 0x3b:
        case 0x3c:
        case 0x3d:
        case 0x3e: {
          const { align, offset, memory } = readMemArg(r);
          const v = pop();
          push(makeStore(opcode as Opcode, offset, align, pop(), v, memory));
          break;
        }

        case 0x3f:
          push(makeMemorySize(varIndex(r.readU8())));
          break; // memory.size
        case 0x40: { // memory.grow
          // The memidx byte precedes the operand, so read it first.
          const growMem = r.readU8();
          push(makeMemoryGrow(pop(), varIndex(growMem)));
          break;
        }

        case 0x41:
          push(makeI32Const(r.readI32()));
          break;
        case 0x42:
          push(makeI64Const(r.readI64()));
          break;
        case 0x43:
          push(makeF32ConstBits(r.readF32Bits()));
          break;
        case 0x44:
          push(makeF64ConstBits(r.readF64Bits()));
          break;

        case 0xd0: { // ref.null
          push(makeRefNull(readRefNullType(r)));
          break;
        }
        case 0xd1: { // ref.is_null
          push(makeRefIsNull(pop()));
          break;
        }
        case 0xd2: { // ref.func
          push(makeRefFunc(varName(ctx.names.func(r.readU32()))));
          break;
        }
        case 0xd3: { // ref.eq
          const b2 = pop();
          const a2 = pop();
          push(makeRefEq(a2, b2));
          break;
        }
        case 0xd4: { // ref.as_non_null
          const r0 = pop();
          // Result is the operand's own type made non-nullable; for a plain
          // ValType ref (the AnyRef-collapse shim) there is nothing to sharpen,
          // so carry the operand type through unchanged.
          const r0t = typeOf(r0);
          const rt = isRefType(r0t) ? { ...r0t, nullable: false } : r0t;
          push(makeRefAsNonNull(r0, rt));
          break;
        }
        case 0xd5: { // br_on_null
          const depth = r.readU32();
          const ref = pop();
          push(makeBrOn(BrOnOp.Null, resolveLabel(frames, depth), ref, typeOf(ref)));
          break;
        }
        case 0xd6: { // br_on_non_null
          const depth = r.readU32();
          const ref = pop();
          push(makeBrOn(BrOnOp.NonNull, resolveLabel(frames, depth), ref, typeOf(ref)));
          break;
        }

        case 0xfb:
          decodeGcPrefix(r, push, pop, ctx, frames);
          break;
        case 0xfc:
          decodeMiscPrefix(r, push, pop, ctx);
          break;
        case 0xfd:
          decodeSIMDPrefix(r, push, pop);
          break;

        default: {
          const unary = UNARY_OPCODE[opcode];
          if (unary !== undefined) {
            push(makeUnary(unary, pop()));
            break;
          }
          const binary = BINARY_OPCODE[opcode];
          if (binary !== undefined) {
            const rhs = pop();
            push(makeBinary(binary, pop(), rhs));
            break;
          }
          // Genuinely unknown opcode. Pushing a `nop` "to keep the stack
          // consistent" actually corrupted it (the unknown opcode's stack effect is
          // unknown) and silently dropped the instruction. Fail loudly so an
          // unsupported module is reported rather than miscompiled.
          r.error(`unknown opcode 0x${opcode.toString(16)}`);
        }
      }
    }

    const funcFrame = frames[0] ?? { exprs: [], label: undefined };
    const body = makeRegion(funcFrame.exprs);

    return {
      name: ctx.names.func(funcIdx),
      // The function-frame label is the target of a `br` that exits the whole
      // function. A region carries no label, so record it here for the encoder
      // to seed; otherwise such a branch mis-resolves.
      bodyFrameLabel: funcFrame.label,
      params: ft.params,
      results: ft.results,
      locals,
      body,
    };
  }
}

// ---------------------------------------------------------------------------
// 0xFB prefix — GC instructions
// ---------------------------------------------------------------------------

function gcRefType(typeIndex: number): RefType {
  return { heapType: varIndex(typeIndex), nullable: false };
}

function decodeGcPrefix(
  r: BinaryReader,
  push: (e: Expression) => void,
  pop: () => Expression,
  ctx: DecoderCtx,
  frames: ControlFrame[],
): void {
  const sub = r.readU32();
  switch (sub) {
    case 0x00: { // struct.new $T
      const ti = r.readU32();
      const def = ctx.heapTypeDefs[ti];
      const n = (def?.kind === 'struct') ? def.fields.length : 0;
      const ops: Expression[] = [];
      for (let i = 0; i < n; i++) ops.unshift(pop());
      push(makeStructNew(varIndex(ti), ops, gcRefType(ti)));
      break;
    }
    case 0x01: { // struct.new_default $T
      const ti = r.readU32();
      push(makeStructNewDefault(varIndex(ti), gcRefType(ti)));
      break;
    }
    case 0x02: { // struct.get $T $f
      const ti = r.readU32();
      const fi = r.readU32();
      const ref = pop();
      const def = ctx.heapTypeDefs[ti];
      const ft = (def?.kind === 'struct') ? def.fields[fi] : undefined;
      const rt: Type = ft ? (isRefType(ft.type) ? ft.type : ft.type as ValType) : ValType.I32;
      // Plain `get`: no sign, which is not the same as `get_u`.
      push(makeStructGet(varIndex(ti), varIndex(fi), ref, rt));
      break;
    }
    case 0x03: { // struct.get_s $T $f
      const ti = r.readU32();
      const fi = r.readU32();
      push(makeStructGet(varIndex(ti), varIndex(fi), pop(), ValType.I32, true));
      break;
    }
    case 0x04: { // struct.get_u $T $f
      const ti = r.readU32();
      const fi = r.readU32();
      push(makeStructGet(varIndex(ti), varIndex(fi), pop(), ValType.I32, false));
      break;
    }
    case 0x05: { // struct.set $T $f
      const ti = r.readU32();
      const fi = r.readU32();
      const val = pop();
      const ref = pop();
      push(makeStructSet(varIndex(ti), varIndex(fi), ref, val));
      break;
    }
    case 0x06: { // array.new $T
      const ti = r.readU32();
      const len = pop();
      const init = pop();
      push(makeArrayNew(varIndex(ti), init, len, gcRefType(ti)));
      break;
    }
    case 0x07: { // array.new_default $T
      const ti = r.readU32();
      push(makeArrayNewDefault(varIndex(ti), pop(), gcRefType(ti)));
      break;
    }
    case 0x08: { // array.new_fixed $T n
      const ti = r.readU32();
      const n = r.readU32();
      const vals: Expression[] = [];
      for (let i = 0; i < n; i++) vals.unshift(pop());
      push(makeArrayNewFixed(varIndex(ti), vals, gcRefType(ti)));
      break;
    }
    case 0x09: { // array.new_data $T $d
      const ti = r.readU32();
      const di = r.readU32();
      const len = pop();
      const off = pop();
      push(makeArrayNewData(varIndex(ti), varIndex(di), off, len, gcRefType(ti)));
      break;
    }
    case 0x0a: { // array.new_elem $T $e
      const ti = r.readU32();
      const ei = r.readU32();
      const len = pop();
      const off = pop();
      push(makeArrayNewElem(varIndex(ti), varIndex(ei), off, len, gcRefType(ti)));
      break;
    }
    case 0x0b: { // array.get $T
      const ti = r.readU32();
      const def = ctx.heapTypeDefs[ti];
      const eft = (def?.kind === 'array') ? def.element : undefined;
      const rt: Type = eft ? (isRefType(eft.type) ? eft.type : eft.type as ValType) : ValType.I32;
      const idx = pop();
      const ref = pop();
      // Plain `get`: no sign, which is not the same as `get_u`.
      push(makeArrayGet(varIndex(ti), ref, idx, rt));
      break;
    }
    case 0x0c: { // array.get_s $T
      const ti = r.readU32();
      const idx = pop();
      const ref = pop();
      push(makeArrayGet(varIndex(ti), ref, idx, ValType.I32, true));
      break;
    }
    case 0x0d: { // array.get_u $T
      const ti = r.readU32();
      const idx = pop();
      const ref = pop();
      push(makeArrayGet(varIndex(ti), ref, idx, ValType.I32, false));
      break;
    }
    case 0x0e: { // array.set $T
      const ti = r.readU32();
      const val = pop();
      const idx = pop();
      const ref = pop();
      push(makeArraySet(varIndex(ti), ref, idx, val));
      break;
    }
    case 0x0f: { // array.len
      push(makeArrayLen(pop()));
      break;
    }
    // array.fill / array.copy / array.init_data / array.init_elem — bulk array
    // GC ops. These previously decoded to a loud error (and before that, to a
    // single-element `array.set` or a bare `nop`, both silent miscompiles).
    // They now have real IR nodes. Operands pop in reverse push order.
    case 0x10: { // array.fill $T
      const ti = r.readU32();
      const size = pop();
      const value = pop();
      const index = pop();
      const ref = pop();
      push(makeArrayFill(varIndex(ti), ref, index, value, size));
      break;
    }
    case 0x11: { // array.copy $Tdest $Tsrc
      const destTi = r.readU32();
      const srcTi = r.readU32();
      const size = pop();
      const srcIndex = pop();
      const srcRef = pop();
      const destIndex = pop();
      const destRef = pop();
      push(
        makeArrayCopy(
          varIndex(destTi),
          varIndex(srcTi),
          destRef,
          destIndex,
          srcRef,
          srcIndex,
          size,
        ),
      );
      break;
    }
    case 0x12: { // array.init_data $T $seg
      const ti = r.readU32();
      const seg = r.readU32();
      const size = pop();
      const offset = pop();
      const index = pop();
      const ref = pop();
      push(makeArrayInitData(varIndex(ti), varIndex(seg), ref, index, offset, size));
      break;
    }
    case 0x13: { // array.init_elem $T $seg
      const ti = r.readU32();
      const seg = r.readU32();
      const size = pop();
      const offset = pop();
      const index = pop();
      const ref = pop();
      push(makeArrayInitElem(varIndex(ti), varIndex(seg), ref, index, offset, size));
      break;
    }
    case 0x14: { // ref.test $T
      const ht = readHeapType(r);
      push(makeRefTest(pop(), ht, false));
      break;
    }
    case 0x15: { // ref.test null $T
      const ht = readHeapType(r);
      push(makeRefTest(pop(), ht, true));
      break;
    }
    case 0x16: { // ref.cast $T
      const ht = readHeapType(r);
      push(makeRefCast(pop(), ht, false, { heapType: ht, nullable: false }));
      break;
    }
    case 0x17: { // ref.cast null $T
      const ht = readHeapType(r);
      push(makeRefCast(pop(), ht, true, { heapType: ht, nullable: true }));
      break;
    }
    case 0x18: { // br_on_cast flags label $T1 $T2
      const flags = r.readU8();
      const depth = r.readU32();
      const ht1 = readHeapType(r); // source heap type
      const ht2 = readHeapType(r); // target (cast) heap type
      const ref = pop();
      push(makeBrOn(
        BrOnOp.Cast,
        resolveLabel(frames, depth),
        ref,
        typeOf(ref),
        ht2,
        (flags & 0x02) !== 0,
        ht1,
        (flags & 0x01) !== 0,
      ));
      break;
    }
    case 0x19: { // br_on_cast_fail flags label $T1 $T2
      const flags = r.readU8();
      const depth = r.readU32();
      const ht1 = readHeapType(r); // source heap type
      const ht2 = readHeapType(r); // target (cast) heap type
      const ref = pop();
      push(makeBrOn(
        BrOnOp.CastFail,
        resolveLabel(frames, depth),
        ref,
        typeOf(ref),
        ht2,
        (flags & 0x02) !== 0,
        ht1,
        (flags & 0x01) !== 0,
      ));
      break;
    }
    case 0x1a: // any.convert_extern
    case 0x1b: { // extern.convert_any
      // This was `push(pop()); // identity conversion in IR`. The value
      // survived and the TYPE did not, so the opcode vanished on re-encode —
      // V8 rejected the result wherever the conversion was load-bearing.
      push(makeExternConvert(
        sub === 0x1a ? ExpressionKind.AnyConvertExtern : ExpressionKind.ExternConvertAny,
        pop(),
      ));
      break;
    }
    case 0x1c: { // ref.i31
      push(makeRefI31(pop(), { heapType: heapAbstract(AbstractHeapType.I31), nullable: false }));
      break;
    }
    case 0x1d: { // i31.get_s
      push(makeI31Get(pop(), true));
      break;
    }
    case 0x1e: { // i31.get_u
      push(makeI31Get(pop(), false));
      break;
    }
    default:
      // Unimplemented GC sub-opcode. A `nop` here silently dropped the opcode and
      // its operands; fail loudly instead.
      r.error(`unsupported GC opcode: 0xFB 0x${sub.toString(16)}`);
  }
}

// ---------------------------------------------------------------------------
// 0xFC prefix (bulk memory + saturating truncations)
// ---------------------------------------------------------------------------

/**
 * A tag's payload types, by tag INDEX — imported tags first.
 *
 * 🔧 This read `ctx.tagInfos[tagIdx]`, but `tagInfos` holds only the DEFINED
 * tags: with an imported tag, index 0 named the first defined tag's payload or
 * nothing, and the `?? []` fallback made a `throw` of an imported
 * `(param i32 i64)` tag pop ZERO operands. Its payload was left behind as loose
 * statements; the bytes happened to round-trip, but the IR said `throw` with no
 * payload, which is not the program. An index past the end is now an error, not
 * an empty payload.
 */
function tagParamsAt(ctx: DecoderCtx, tagIdx: number, r: BinaryReader): ValueType[] {
  return ctx.tagParams[tagIdx] ?? r.error(`tag index ${tagIdx} is out of range`);
}

/** A data segment's name — the one `readDataSection` gave it. */
function dataSegName(ctx: DecoderCtx, i: number): string {
  return ctx.names.data(i);
}

/** An element segment's, likewise. */
function elemSegName(ctx: DecoderCtx, i: number): string {
  return ctx.names.elem(i);
}

/** A table's name, by index. */
function tableName(ctx: DecoderCtx, i: number): string {
  return ctx.names.table(i);
}

function decodeMiscPrefix(
  r: BinaryReader,
  push: (e: Expression) => void,
  pop: () => Expression,
  ctx: DecoderCtx,
): void {
  const sub = r.readU32();
  switch (sub) {
    case 0:
      push(makeUnary(UnaryOp.TruncSF32ToI32, pop()));
      break; // i32.trunc_sat_f32_s
    case 1:
      push(makeUnary(UnaryOp.TruncUF32ToI32, pop()));
      break;
    case 2:
      push(makeUnary(UnaryOp.TruncSF64ToI32, pop()));
      break;
    case 3:
      push(makeUnary(UnaryOp.TruncUF64ToI32, pop()));
      break;
    case 4:
      push(makeUnary(UnaryOp.TruncSF32ToI64, pop()));
      break;
    case 5:
      push(makeUnary(UnaryOp.TruncUF32ToI64, pop()));
      break;
    case 6:
      push(makeUnary(UnaryOp.TruncSF64ToI64, pop()));
      break;
    case 7:
      push(makeUnary(UnaryOp.TruncUF64ToI64, pop()));
      break;
    case 10: { // memory.copy
      const dstMem = r.readU8();
      const srcMem = r.readU8();
      const size = pop();
      const src = pop();
      const dst = pop();
      push(makeMemoryCopy(dst, src, size, varIndex(dstMem), varIndex(srcMem)));
      break;
    }
    case 11: { // memory.fill
      const fillMem = r.readU8();
      const size = pop();
      const val = pop();
      const dst = pop();
      push(makeMemoryFill(dst, val, size, varIndex(fillMem)));
      break;
    }
    // The eight bulk-memory / table operations. Each pops its operands in
    // REVERSE, because the last pushed is the last operand.
    //
    // 🔧 These all used to `r.error(...)` as unsupported, and before that they
    // decoded to `nop` — silently dropping the operation, with several popping
    // the WRONG operand count. The loud refusal was the right interim answer;
    // it is retired now that the IR can represent every one of them.
    case 8: { // memory.init
      const segIdx = r.readU32();
      const initMem = r.readU8();
      const size = pop();
      const offset = pop();
      const dst = pop();
      push(makeMemoryInit(varName(dataSegName(ctx, segIdx)), dst, offset, size, varIndex(initMem)));
      break;
    }
    case 9: { // data.drop
      push(makeDataDrop(varName(dataSegName(ctx, r.readU32()))));
      break;
    }
    case 12: { // table.init
      // Segment index FIRST, then table — the reverse of `table.copy`.
      const segIdx = r.readU32();
      const tableIdx = r.readU32();
      const size = pop();
      const offset = pop();
      const dst = pop();
      push(
        makeTableInit(
          varName(elemSegName(ctx, segIdx)),
          varName(tableName(ctx, tableIdx)),
          dst,
          offset,
          size,
        ),
      );
      break;
    }
    case 13: { // elem.drop
      push(makeElemDrop(varName(elemSegName(ctx, r.readU32()))));
      break;
    }
    case 14: { // table.copy
      const dstTable = r.readU32();
      const srcTable = r.readU32();
      const size = pop();
      const src = pop();
      const dst = pop();
      push(
        makeTableCopy(
          varName(tableName(ctx, dstTable)),
          varName(tableName(ctx, srcTable)),
          dst,
          src,
          size,
        ),
      );
      break;
    }
    case 15: { // table.grow
      const tableIdx = r.readU32();
      const delta = pop();
      const value = pop();
      push(makeTableGrow(varName(tableName(ctx, tableIdx)), value, delta));
      break;
    }
    case 16: { // table.size
      push(makeTableSize(varName(tableName(ctx, r.readU32()))));
      break;
    }
    case 17: { // table.fill
      const tableIdx = r.readU32();
      const size = pop();
      const value = pop();
      const dst = pop();
      push(makeTableFill(varName(tableName(ctx, tableIdx)), dst, value, size));
      break;
    }
    // Any FUTURE 0xFC sub-opcode. Kept failing loud for the reason the eight
    // above used to: decoding an unknown opcode to `nop` drops it silently, and
    // guessing its operand count corrupts the stack. A consumer can detect an
    // unsupported module; it cannot detect garbage.
    // --- Wide arithmetic (0xfc 0x13-0x16) --------------------------------
    //
    // Four i64 in and two out for add128/sub128; two in and two out for the
    // mul_wide pair. Operands pop in REVERSE, last-pushed first.
    case 19: // i64.add128
    case 20: { // i64.sub128
      const d = pop();
      const c = pop();
      const b = pop();
      const a = pop();
      push(makeQuaternary(
        sub === 19 ? QuaternaryOp.Add128 : QuaternaryOp.Sub128,
        a,
        b,
        c,
        d,
      ));
      break;
    }
    case 21: // i64.mul_wide_s
    case 22: { // i64.mul_wide_u
      const right = pop();
      const left = pop();
      // Two results, so the node's type is a tuple rather than a value type.
      const mul = makeBinary(
        sub === 21 ? BinaryOp.MulWideSInt64 : BinaryOp.MulWideUInt64,
        left,
        right,
      );
      push({ ...mul, type: [ValType.I64, ValType.I64] });
      break;
    }
    default:
      r.error(`unsupported bulk-memory/table opcode: ${FC_SUBOP_NAME(sub)}`);
  }
}

/** Human-readable name for an unsupported 0xFC bulk-memory / table sub-opcode. */
function FC_SUBOP_NAME(sub: number): string {
  switch (sub) {
    case 8:
      return 'memory.init';
    case 9:
      return 'data.drop';
    case 12:
      return 'table.init';
    case 13:
      return 'elem.drop';
    case 14:
      return 'table.copy';
    case 15:
      return 'table.grow';
    case 16:
      return 'table.size';
    case 17:
      return 'table.fill';
    default:
      return `0xFC 0x${sub.toString(16)}`;
  }
}

// ---------------------------------------------------------------------------
// 0xFD prefix — SIMD instructions
// ---------------------------------------------------------------------------

function decodeSIMDPrefix(
  r: BinaryReader,
  push: (e: Expression) => void,
  pop: () => Expression,
): void {
  const sub = r.readU32();
  switch (sub) {
    // ---- loads ----
    case 0x00: { // v128.load (16 bytes)
      const { align, offset, memory } = readMemArg(r);
      push(makeLoad(OPCODE_V128_LOAD, offset, align, pop(), memory));
      break;
    }
    case 0x01: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load8x8SVec128, pop(), offset, align, memory));
      break;
    }
    case 0x02: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load8x8UVec128, pop(), offset, align, memory));
      break;
    }
    case 0x03: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load16x4SVec128, pop(), offset, align, memory));
      break;
    }
    case 0x04: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load16x4UVec128, pop(), offset, align, memory));
      break;
    }
    case 0x05: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load32x2SVec128, pop(), offset, align, memory));
      break;
    }
    case 0x06: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load32x2UVec128, pop(), offset, align, memory));
      break;
    }
    case 0x07: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load8SplatVec128, pop(), offset, align, memory));
      break;
    }
    case 0x08: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load16SplatVec128, pop(), offset, align, memory));
      break;
    }
    case 0x09: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load32SplatVec128, pop(), offset, align, memory));
      break;
    }
    case 0x0a: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load64SplatVec128, pop(), offset, align, memory));
      break;
    }
    case 0x0b: { // v128.store
      const { align, offset, memory } = readMemArg(r);
      const value = pop();
      const ptr = pop();
      push(makeStore(OPCODE_V128_STORE, offset, align, ptr, value, memory));
      break;
    }
    case 0x0c: { // v128.const — read 16 bytes
      const bytes = r.readBytes(16);
      push(makeV128Const(bytes));
      break;
    }
    case 0x0d: { // i8x16.shuffle — 16 lane-select bytes
      const mask = r.readBytes(16);
      const right = pop();
      const left = pop();
      push(makeSIMDShuffle(left, right, mask));
      break;
    }
    case 0x0e: {
      const right = pop();
      push(makeBinary(BinaryOp.SwizzleVecI8x16, pop(), right));
      break;
    }
    // ---- splats ----
    case 0x0f:
      push(makeUnary(UnaryOp.SplatVecI8x16, pop()));
      break;
    case 0x10:
      push(makeUnary(UnaryOp.SplatVecI16x8, pop()));
      break;
    case 0x11:
      push(makeUnary(UnaryOp.SplatVecI32x4, pop()));
      break;
    case 0x12:
      push(makeUnary(UnaryOp.SplatVecI64x2, pop()));
      break;
    case 0x13:
      push(makeUnary(UnaryOp.SplatVecF32x4, pop()));
      break;
    case 0x14:
      push(makeUnary(UnaryOp.SplatVecF64x2, pop()));
      break;
    // ---- extract / replace lane ----
    case 0x15: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneSVecI8x16, pop(), lane));
      break;
    }
    case 0x16: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneUVecI8x16, pop(), lane));
      break;
    }
    case 0x17: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecI8x16, pop(), lane, value));
      break;
    }
    case 0x18: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneSVecI16x8, pop(), lane));
      break;
    }
    case 0x19: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneUVecI16x8, pop(), lane));
      break;
    }
    case 0x1a: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecI16x8, pop(), lane, value));
      break;
    }
    case 0x1b: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneVecI32x4, pop(), lane));
      break;
    }
    case 0x1c: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecI32x4, pop(), lane, value));
      break;
    }
    case 0x1d: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneVecI64x2, pop(), lane));
      break;
    }
    case 0x1e: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecI64x2, pop(), lane, value));
      break;
    }
    case 0x1f: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneVecF32x4, pop(), lane));
      break;
    }
    case 0x20: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecF32x4, pop(), lane, value));
      break;
    }
    case 0x21: {
      const lane = r.readU8();
      push(makeSIMDExtract(SIMDExtractOp.ExtractLaneVecF64x2, pop(), lane));
      break;
    }
    case 0x22: {
      const lane = r.readU8();
      const value = pop();
      push(makeSIMDReplace(SIMDReplaceOp.ReplaceLaneVecF64x2, pop(), lane, value));
      break;
    }
    // ---- i8x16 comparisons ----
    case 0x23: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecI8x16, pop(), r2));
      break;
    }
    case 0x24: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecI8x16, pop(), r2));
      break;
    }
    case 0x25: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtSVecI8x16, pop(), r2));
      break;
    }
    case 0x26: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtUVecI8x16, pop(), r2));
      break;
    }
    case 0x27: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtSVecI8x16, pop(), r2));
      break;
    }
    case 0x28: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtUVecI8x16, pop(), r2));
      break;
    }
    case 0x29: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeSVecI8x16, pop(), r2));
      break;
    }
    case 0x2a: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeUVecI8x16, pop(), r2));
      break;
    }
    case 0x2b: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeSVecI8x16, pop(), r2));
      break;
    }
    case 0x2c: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeUVecI8x16, pop(), r2));
      break;
    }
    // ---- i16x8 comparisons ----
    case 0x2d: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecI16x8, pop(), r2));
      break;
    }
    case 0x2e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecI16x8, pop(), r2));
      break;
    }
    case 0x2f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtSVecI16x8, pop(), r2));
      break;
    }
    case 0x30: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtUVecI16x8, pop(), r2));
      break;
    }
    case 0x31: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtSVecI16x8, pop(), r2));
      break;
    }
    case 0x32: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtUVecI16x8, pop(), r2));
      break;
    }
    case 0x33: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeSVecI16x8, pop(), r2));
      break;
    }
    case 0x34: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeUVecI16x8, pop(), r2));
      break;
    }
    case 0x35: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeSVecI16x8, pop(), r2));
      break;
    }
    case 0x36: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeUVecI16x8, pop(), r2));
      break;
    }
    // ---- i32x4 comparisons ----
    case 0x37: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecI32x4, pop(), r2));
      break;
    }
    case 0x38: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecI32x4, pop(), r2));
      break;
    }
    case 0x39: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtSVecI32x4, pop(), r2));
      break;
    }
    case 0x3a: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtUVecI32x4, pop(), r2));
      break;
    }
    case 0x3b: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtSVecI32x4, pop(), r2));
      break;
    }
    case 0x3c: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtUVecI32x4, pop(), r2));
      break;
    }
    case 0x3d: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeSVecI32x4, pop(), r2));
      break;
    }
    case 0x3e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeUVecI32x4, pop(), r2));
      break;
    }
    case 0x3f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeSVecI32x4, pop(), r2));
      break;
    }
    case 0x40: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeUVecI32x4, pop(), r2));
      break;
    }
    // ---- f32x4 comparisons ----
    case 0x41: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecF32x4, pop(), r2));
      break;
    }
    case 0x42: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecF32x4, pop(), r2));
      break;
    }
    case 0x43: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtVecF32x4, pop(), r2));
      break;
    }
    case 0x44: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtVecF32x4, pop(), r2));
      break;
    }
    case 0x45: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeVecF32x4, pop(), r2));
      break;
    }
    case 0x46: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeVecF32x4, pop(), r2));
      break;
    }
    // ---- f64x2 comparisons ----
    case 0x47: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecF64x2, pop(), r2));
      break;
    }
    case 0x48: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecF64x2, pop(), r2));
      break;
    }
    case 0x49: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtVecF64x2, pop(), r2));
      break;
    }
    case 0x4a: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtVecF64x2, pop(), r2));
      break;
    }
    case 0x4b: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeVecF64x2, pop(), r2));
      break;
    }
    case 0x4c: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeVecF64x2, pop(), r2));
      break;
    }
    // ---- v128 bitwise ----
    case 0x4d:
      push(makeUnary(UnaryOp.NotVec128, pop()));
      break;
    case 0x4e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AndVec128, pop(), r2));
      break;
    }
    case 0x4f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AndNotVec128, pop(), r2));
      break;
    }
    case 0x50: {
      const r2 = pop();
      push(makeBinary(BinaryOp.OrVec128, pop(), r2));
      break;
    }
    case 0x51: {
      const r2 = pop();
      push(makeBinary(BinaryOp.XorVec128, pop(), r2));
      break;
    }
    case 0x52: {
      const c2 = pop();
      const b2 = pop();
      push(makeSIMDTernary(SIMDTernaryOp.Bitselect, pop(), b2, c2));
      break;
    }
    case 0x53:
      push(makeUnary(UnaryOp.AnyTrueVec128, pop()));
      break;
    // ---- load / store lane ----
    case 0x54: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Load8LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x55: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Load16LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x56: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Load32LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x57: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Load64LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x58: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Store8LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x59: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Store16LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x5a: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Store32LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x5b: {
      const { align, offset, memory } = readMemArg(r);
      const lane = r.readU8();
      const vec = pop();
      push(
        makeSIMDLoadStoreLane(
          SIMDLoadStoreLaneOp.Store64LaneVec128,
          pop(),
          vec,
          offset,
          align,
          lane,
          memory,
        ),
      );
      break;
    }
    case 0x5c: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load32ZeroVec128, pop(), offset, align, memory));
      break;
    }
    case 0x5d: {
      const { align, offset, memory } = readMemArg(r);
      push(makeSIMDLoad(SIMDLoadOp.Load64ZeroVec128, pop(), offset, align, memory));
      break;
    }
    // ---- float conversions ----
    case 0x5e:
      push(makeUnary(UnaryOp.DemoteZeroVecF64x2ToF32x4, pop()));
      break;
    case 0x5f:
      push(makeUnary(UnaryOp.PromoteLowVecF32x4ToF64x2, pop()));
      break;
    // ---- i8x16 unary ----
    case 0x60:
      push(makeUnary(UnaryOp.AbsVecI8x16, pop()));
      break;
    case 0x61:
      push(makeUnary(UnaryOp.NegVecI8x16, pop()));
      break;
    case 0x62:
      push(makeUnary(UnaryOp.PopcntVecI8x16, pop()));
      break;
    case 0x63:
      push(makeUnary(UnaryOp.AllTrueVecI8x16, pop()));
      break;
    case 0x64:
      push(makeUnary(UnaryOp.BitmaskVecI8x16, pop()));
      break;
    case 0x65: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NarrowSVecI16x8ToI8x16, pop(), r2));
      break;
    }
    case 0x66: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NarrowUVecI16x8ToI8x16, pop(), r2));
      break;
    }
    case 0x67:
      push(makeUnary(UnaryOp.CeilVecF32x4, pop()));
      break;
    case 0x68:
      push(makeUnary(UnaryOp.FloorVecF32x4, pop()));
      break;
    case 0x69:
      push(makeUnary(UnaryOp.TruncVecF32x4, pop()));
      break;
    case 0x6a:
      push(makeUnary(UnaryOp.NearestVecF32x4, pop()));
      break;
    case 0x6b: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShlVecI8x16, pop(), shift));
      break;
    }
    case 0x6c: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrSVecI8x16, pop(), shift));
      break;
    }
    case 0x6d: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrUVecI8x16, pop(), shift));
      break;
    }
    case 0x6e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecI8x16, pop(), r2));
      break;
    }
    case 0x6f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddSatSVecI8x16, pop(), r2));
      break;
    }
    case 0x70: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddSatUVecI8x16, pop(), r2));
      break;
    }
    case 0x71: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecI8x16, pop(), r2));
      break;
    }
    case 0x72: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubSatSVecI8x16, pop(), r2));
      break;
    }
    case 0x73: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubSatUVecI8x16, pop(), r2));
      break;
    }
    case 0x74:
      push(makeUnary(UnaryOp.CeilVecF64x2, pop()));
      break;
    case 0x75:
      push(makeUnary(UnaryOp.FloorVecF64x2, pop()));
      break;
    case 0x76: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinSVecI8x16, pop(), r2));
      break;
    }
    case 0x77: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinUVecI8x16, pop(), r2));
      break;
    }
    case 0x78: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxSVecI8x16, pop(), r2));
      break;
    }
    case 0x79: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxUVecI8x16, pop(), r2));
      break;
    }
    case 0x7a:
      push(makeUnary(UnaryOp.TruncVecF64x2, pop()));
      break;
    case 0x7b: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AvgrUVecI8x16, pop(), r2));
      break;
    }
    case 0x7c:
      push(makeUnary(UnaryOp.ExtaddPairwiseSVecI8x16ToI16x8, pop()));
      break;
    case 0x7d:
      push(makeUnary(UnaryOp.ExtaddPairwiseUVecI8x16ToI16x8, pop()));
      break;
    case 0x7e:
      push(makeUnary(UnaryOp.ExtaddPairwiseSVecI16x8ToI32x4, pop()));
      break;
    case 0x7f:
      push(makeUnary(UnaryOp.ExtaddPairwiseUVecI16x8ToI32x4, pop()));
      break;
    // ---- i16x8 ----
    case 0x80:
      push(makeUnary(UnaryOp.AbsVecI16x8, pop()));
      break;
    case 0x81:
      push(makeUnary(UnaryOp.NegVecI16x8, pop()));
      break;
    case 0x82: {
      const r2 = pop();
      push(makeBinary(BinaryOp.Q15MulrSatSVecI16x8, pop(), r2));
      break;
    }
    case 0x83:
      push(makeUnary(UnaryOp.AllTrueVecI16x8, pop()));
      break;
    case 0x84:
      push(makeUnary(UnaryOp.BitmaskVecI16x8, pop()));
      break;
    case 0x85: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NarrowSVecI32x4ToI16x8, pop(), r2));
      break;
    }
    case 0x86: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NarrowUVecI32x4ToI16x8, pop(), r2));
      break;
    }
    case 0x87:
      push(makeUnary(UnaryOp.ExtendLowSVecI8x16ToI16x8, pop()));
      break;
    case 0x88:
      push(makeUnary(UnaryOp.ExtendHighSVecI8x16ToI16x8, pop()));
      break;
    case 0x89:
      push(makeUnary(UnaryOp.ExtendLowUVecI8x16ToI16x8, pop()));
      break;
    case 0x8a:
      push(makeUnary(UnaryOp.ExtendHighUVecI8x16ToI16x8, pop()));
      break;
    case 0x8b: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShlVecI16x8, pop(), shift));
      break;
    }
    case 0x8c: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrSVecI16x8, pop(), shift));
      break;
    }
    case 0x8d: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrUVecI16x8, pop(), shift));
      break;
    }
    case 0x8e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecI16x8, pop(), r2));
      break;
    }
    case 0x8f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddSatSVecI16x8, pop(), r2));
      break;
    }
    case 0x90: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddSatUVecI16x8, pop(), r2));
      break;
    }
    case 0x91: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecI16x8, pop(), r2));
      break;
    }
    case 0x92: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubSatSVecI16x8, pop(), r2));
      break;
    }
    case 0x93: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubSatUVecI16x8, pop(), r2));
      break;
    }
    case 0x94:
      push(makeUnary(UnaryOp.NearestVecF64x2, pop()));
      break;
    case 0x95: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MulVecI16x8, pop(), r2));
      break;
    }
    case 0x96: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinSVecI16x8, pop(), r2));
      break;
    }
    case 0x97: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinUVecI16x8, pop(), r2));
      break;
    }
    case 0x98: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxSVecI16x8, pop(), r2));
      break;
    }
    case 0x99: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxUVecI16x8, pop(), r2));
      break;
    }
    case 0x9b: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AvgrUVecI16x8, pop(), r2));
      break;
    }
    case 0x9c: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowSVecI8x16ToI16x8, pop(), r2));
      break;
    }
    case 0x9d: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighSVecI8x16ToI16x8, pop(), r2));
      break;
    }
    case 0x9e: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowUVecI8x16ToI16x8, pop(), r2));
      break;
    }
    case 0x9f: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighUVecI8x16ToI16x8, pop(), r2));
      break;
    }
    // ---- i32x4 ----
    case 0xa0:
      push(makeUnary(UnaryOp.AbsVecI32x4, pop()));
      break;
    case 0xa1:
      push(makeUnary(UnaryOp.NegVecI32x4, pop()));
      break;
    case 0xa3:
      push(makeUnary(UnaryOp.AllTrueVecI32x4, pop()));
      break;
    case 0xa4:
      push(makeUnary(UnaryOp.BitmaskVecI32x4, pop()));
      break;
    case 0xa7:
      push(makeUnary(UnaryOp.ExtendLowSVecI16x8ToI32x4, pop()));
      break;
    case 0xa8:
      push(makeUnary(UnaryOp.ExtendHighSVecI16x8ToI32x4, pop()));
      break;
    case 0xa9:
      push(makeUnary(UnaryOp.ExtendLowUVecI16x8ToI32x4, pop()));
      break;
    case 0xaa:
      push(makeUnary(UnaryOp.ExtendHighUVecI16x8ToI32x4, pop()));
      break;
    case 0xab: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShlVecI32x4, pop(), shift));
      break;
    }
    case 0xac: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrSVecI32x4, pop(), shift));
      break;
    }
    case 0xad: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrUVecI32x4, pop(), shift));
      break;
    }
    case 0xae: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecI32x4, pop(), r2));
      break;
    }
    case 0xb1: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecI32x4, pop(), r2));
      break;
    }
    case 0xb5: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MulVecI32x4, pop(), r2));
      break;
    }
    case 0xb6: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinSVecI32x4, pop(), r2));
      break;
    }
    case 0xb7: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinUVecI32x4, pop(), r2));
      break;
    }
    case 0xb8: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxSVecI32x4, pop(), r2));
      break;
    }
    case 0xb9: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxUVecI32x4, pop(), r2));
      break;
    }
    case 0xba: {
      const r2 = pop();
      push(makeBinary(BinaryOp.DotSVecI16x8ToI32x4, pop(), r2));
      break;
    }
    case 0xbc: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowSVecI16x8ToI32x4, pop(), r2));
      break;
    }
    case 0xbd: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighSVecI16x8ToI32x4, pop(), r2));
      break;
    }
    case 0xbe: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowUVecI16x8ToI32x4, pop(), r2));
      break;
    }
    case 0xbf: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighUVecI16x8ToI32x4, pop(), r2));
      break;
    }
    // ---- i64x2 ----
    case 0xc0:
      push(makeUnary(UnaryOp.AbsVecI64x2, pop()));
      break;
    case 0xc1:
      push(makeUnary(UnaryOp.NegVecI64x2, pop()));
      break;
    case 0xc3:
      push(makeUnary(UnaryOp.AllTrueVecI64x2, pop()));
      break;
    case 0xc4:
      push(makeUnary(UnaryOp.BitmaskVecI64x2, pop()));
      break;
    case 0xc7:
      push(makeUnary(UnaryOp.ExtendLowSVecI32x4ToI64x2, pop()));
      break;
    case 0xc8:
      push(makeUnary(UnaryOp.ExtendHighSVecI32x4ToI64x2, pop()));
      break;
    case 0xc9:
      push(makeUnary(UnaryOp.ExtendLowUVecI32x4ToI64x2, pop()));
      break;
    case 0xca:
      push(makeUnary(UnaryOp.ExtendHighUVecI32x4ToI64x2, pop()));
      break;
    case 0xcb: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShlVecI64x2, pop(), shift));
      break;
    }
    case 0xcc: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrSVecI64x2, pop(), shift));
      break;
    }
    case 0xcd: {
      const shift = pop();
      push(makeBinary(BinaryOp.ShrUVecI64x2, pop(), shift));
      break;
    }
    case 0xce: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecI64x2, pop(), r2));
      break;
    }
    case 0xd1: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecI64x2, pop(), r2));
      break;
    }
    case 0xd5: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MulVecI64x2, pop(), r2));
      break;
    }
    case 0xd6: {
      const r2 = pop();
      push(makeBinary(BinaryOp.EqVecI64x2, pop(), r2));
      break;
    }
    case 0xd7: {
      const r2 = pop();
      push(makeBinary(BinaryOp.NeVecI64x2, pop(), r2));
      break;
    }
    case 0xd8: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LtSVecI64x2, pop(), r2));
      break;
    }
    case 0xd9: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GtSVecI64x2, pop(), r2));
      break;
    }
    case 0xda: {
      const r2 = pop();
      push(makeBinary(BinaryOp.LeSVecI64x2, pop(), r2));
      break;
    }
    case 0xdb: {
      const r2 = pop();
      push(makeBinary(BinaryOp.GeSVecI64x2, pop(), r2));
      break;
    }
    case 0xdc: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowSVecI32x4ToI64x2, pop(), r2));
      break;
    }
    case 0xdd: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighSVecI32x4ToI64x2, pop(), r2));
      break;
    }
    case 0xde: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulLowUVecI32x4ToI64x2, pop(), r2));
      break;
    }
    case 0xdf: {
      const r2 = pop();
      push(makeBinary(BinaryOp.ExtmulHighUVecI32x4ToI64x2, pop(), r2));
      break;
    }
    // ---- f32x4 ----
    case 0xe0:
      push(makeUnary(UnaryOp.AbsVecF32x4, pop()));
      break;
    case 0xe1:
      push(makeUnary(UnaryOp.NegVecF32x4, pop()));
      break;
    case 0xe3:
      push(makeUnary(UnaryOp.SqrtVecF32x4, pop()));
      break;
    case 0xe4: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecF32x4, pop(), r2));
      break;
    }
    case 0xe5: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecF32x4, pop(), r2));
      break;
    }
    case 0xe6: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MulVecF32x4, pop(), r2));
      break;
    }
    case 0xe7: {
      const r2 = pop();
      push(makeBinary(BinaryOp.DivVecF32x4, pop(), r2));
      break;
    }
    case 0xe8: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinVecF32x4, pop(), r2));
      break;
    }
    case 0xe9: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxVecF32x4, pop(), r2));
      break;
    }
    case 0xea: {
      const r2 = pop();
      push(makeBinary(BinaryOp.PminVecF32x4, pop(), r2));
      break;
    }
    case 0xeb: {
      const r2 = pop();
      push(makeBinary(BinaryOp.PmaxVecF32x4, pop(), r2));
      break;
    }
    // ---- f64x2 ----
    case 0xec:
      push(makeUnary(UnaryOp.AbsVecF64x2, pop()));
      break;
    case 0xed:
      push(makeUnary(UnaryOp.NegVecF64x2, pop()));
      break;
    case 0xef:
      push(makeUnary(UnaryOp.SqrtVecF64x2, pop()));
      break;
    case 0xf0: {
      const r2 = pop();
      push(makeBinary(BinaryOp.AddVecF64x2, pop(), r2));
      break;
    }
    case 0xf1: {
      const r2 = pop();
      push(makeBinary(BinaryOp.SubVecF64x2, pop(), r2));
      break;
    }
    case 0xf2: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MulVecF64x2, pop(), r2));
      break;
    }
    case 0xf3: {
      const r2 = pop();
      push(makeBinary(BinaryOp.DivVecF64x2, pop(), r2));
      break;
    }
    case 0xf4: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MinVecF64x2, pop(), r2));
      break;
    }
    case 0xf5: {
      const r2 = pop();
      push(makeBinary(BinaryOp.MaxVecF64x2, pop(), r2));
      break;
    }
    case 0xf6: {
      const r2 = pop();
      push(makeBinary(BinaryOp.PminVecF64x2, pop(), r2));
      break;
    }
    case 0xf7: {
      const r2 = pop();
      push(makeBinary(BinaryOp.PmaxVecF64x2, pop(), r2));
      break;
    }
    // ---- conversions ----
    case 0xf8:
      push(makeUnary(UnaryOp.TruncSatSVecF32x4ToI32x4, pop()));
      break;
    case 0xf9:
      push(makeUnary(UnaryOp.TruncSatUVecF32x4ToI32x4, pop()));
      break;
    case 0xfa:
      push(makeUnary(UnaryOp.ConvertSVecI32x4ToF32x4, pop()));
      break;
    case 0xfb:
      push(makeUnary(UnaryOp.ConvertUVecI32x4ToF32x4, pop()));
      break;
    case 0xfc:
      push(makeUnary(UnaryOp.TruncSatSVecF64x2ToI32x4Zero, pop()));
      break;
    case 0xfd:
      push(makeUnary(UnaryOp.TruncSatUVecF64x2ToI32x4Zero, pop()));
      break;
    case 0xfe:
      push(makeUnary(UnaryOp.ConvertLowSVecI32x4ToF64x2, pop()));
      break;
    case 0xff:
      push(makeUnary(UnaryOp.ConvertLowUVecI32x4ToF64x2, pop()));
      break;
    default:
      // Unknown / relaxed-SIMD sub-opcode. Emitting a `nop` silently dropped the
      // opcode and its operands (stack imbalance / silent opcode loss); fail loudly,
      // matching the GC (0xFB) and bulk-memory (0xFC) decoders.
      r.error(`unsupported SIMD opcode: 0xFD 0x${sub.toString(16)}`);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a WebAssembly binary into a {@link WasmModule} IR tree.
 *
 * @param bytes - The raw `.wasm` binary data.
 * @param _filename - Optional filename for error messages (not yet used).
 * @throws {@link WasmBinaryError} on malformed or truncated input.
 */
export function parseWasm(
  bytes: Uint8Array,
  _filename?: string,
  options: ParseWasmOptions = {},
): WasmModule {
  return new WasmParser(bytes, options).parse();
}

export { WasmBinaryError };
