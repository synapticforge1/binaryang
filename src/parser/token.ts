// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/token.h, include/wabt/token.def
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import type { Location } from '../core/error.ts';
import type { Opcode } from '../core/opcode.ts';
import { Type } from '../core/types.ts';
import type { ValType } from '../core/types.ts';

// ---------------------------------------------------------------------------
// TokenType — mirrors token.def groups
// ---------------------------------------------------------------------------

/** All token kinds, grouped to match token.def semantics. */
export const TokenType = {
  // --- Bare (no payload) ---
  Invalid: 0,
  After: 1,
  Array: 2,
  AssertException: 3,
  AssertExhaustion: 4,
  AssertInvalid: 5,
  AssertMalformed: 6,
  AssertReturn: 7,
  AssertTrap: 8,
  AssertUnlinkable: 9,
  Before: 10,
  Bin: 11,
  Item: 12,
  Data: 13,
  Declare: 14,
  Delegate: 15,
  Do: 16,
  Either: 17,
  Elem: 18,
  Eof: 19,
  Tag: 20,
  Export: 21,
  Field: 22,
  Function: 23,
  Get: 24,
  Global: 25,
  Import: 26,
  Invoke: 27,
  Input: 28,
  Local: 29,
  Lpar: 30,
  Memory: 31,
  Module: 32,
  Mut: 33,
  NanArithmetic: 34,
  NanCanonical: 35,
  Null: 36,
  Offset: 37,
  Output: 38,
  PageSize: 39,
  Param: 40,
  Ref: 41,
  Quote: 42,
  Register: 43,
  Result: 44,
  Rpar: 45,
  Shared: 46,
  Start: 47,
  Struct: 48,
  Table: 49,
  Then: 50,
  Type: 51,
  I8X16: 52,
  I16X8: 53,
  I32X4: 54,
  I64X2: 55,
  F32X4: 56,
  F64X2: 57,

  // --- Literal (payload: LiteralToken) ---
  Float: 58,
  Int: 59,
  Nat: 60,

  // --- Opcode (payload: OpcodeToken) ---
  AtomicFence: 61,
  AtomicLoad: 62,
  AtomicNotify: 63,
  AtomicRmw: 64,
  AtomicRmwCmpxchg: 65,
  AtomicStore: 66,
  AtomicWait: 67,
  Binary: 68,
  Quaternary: 69,
  Block: 70,
  Br: 71,
  BrIf: 72,
  HeapType: 73,
  BrOnCast: 74,
  BrOnCastFail: 75,
  BrOnNonNull: 76,
  BrOnNull: 77,
  BrTable: 78,
  Code: 79,
  Call: 80,
  CallIndirect: 81,
  CallRef: 82,
  ReturnCallRef: 83,
  Catch: 84,
  CatchAll: 85,
  CatchRef: 86,
  CatchAllRef: 87,
  Compare: 88,
  Const: 89,
  Convert: 90,
  DataDrop: 91,
  Drop: 92,
  ElemDrop: 93,
  Else: 94,
  End: 95,
  GlobalGet: 96,
  GlobalSet: 97,
  If: 98,
  Load: 99,
  LocalGet: 100,
  LocalSet: 101,
  LocalTee: 102,
  Loop: 103,
  MemoryCopy: 104,
  MemoryFill: 105,
  MemoryGrow: 106,
  MemoryInit: 107,
  MemorySize: 108,
  Nop: 109,
  RefAsNonNull: 110,
  RefEq: 111,
  Rec: 112,
  Sub: 113,
  Final: 114,
  /** `exact`, `descriptor`, `describes` — custom descriptors. */
  Exact: 115,
  Descriptor: 116,
  Describes: 117,
  Definition: 118,
  Instance: 119,
  RefExtern: 120,
  RefHost: 121,
  RefAny: 122,
  RefStructKw: 123,
  RefArrayKw: 124,
  RefFunc: 125,
  RefI31: 126,
  AnyConvertExtern: 127,
  ExternConvertAny: 128,
  RefIsNull: 129,
  RefNull: 130,
  I31Get: 131,
  StructNew: 132,
  StructNewDefault: 133,
  StructGet: 134,
  StructSet: 135,
  ArrayNew: 136,
  ArrayNewDefault: 137,
  ArrayNewFixed: 138,
  ArrayNewData: 139,
  ArrayNewElem: 140,
  ArrayGet: 141,
  ArraySet: 142,
  ArrayLen: 143,
  ArrayFill: 144,
  ArrayCopy: 145,
  ArrayInitData: 146,
  ArrayInitElem: 147,
  RefTest: 148,
  RefCast: 149,
  // Custom descriptors.
  StructNewDesc: 150,
  StructNewDefaultDesc: 151,
  RefGetDesc: 152,
  RefCastDescEq: 153,
  BrOnCastDescEq: 154,
  BrOnCastDescEqFail: 155,
  Rethrow: 156,
  ReturnCallIndirect: 157,
  ReturnCall: 158,
  Return: 159,
  Select: 160,
  SimdLaneOp: 161,
  SimdLoadSplat: 162,
  SimdLoadLane: 163,
  SimdStoreLane: 164,
  SimdShuffleOp: 165,
  Store: 166,
  TableCopy: 167,
  TableFill: 168,
  TableGet: 169,
  TableGrow: 170,
  TableInit: 171,
  TableSet: 172,
  TableSize: 173,
  Ternary: 174,
  Throw: 175,
  ThrowRef: 176,
  Try: 177,
  TryTable: 178,
  Unary: 179,
  Unreachable: 180,

  // --- String (payload: string) ---
  AlignEqNat: 181,
  LparAnn: 182,
  OffsetEqNat: 183,
  Reserved: 184,
  Text: 185,
  Var: 186,

  // --- Type (payload: Type) ---
  ValueType: 187,

  // --- RefKind (payload: Type for ref types) ---
  Func: 188,
  Extern: 189,
  Exn: 190,
} as const;
/** One of {@link TokenType}'s values. */
export type TokenType = (typeof TokenType)[keyof typeof TokenType];
/** Each member as a type (`TokenType.Invalid`), as when TokenType was an `enum`. */
export declare namespace TokenType {
  type Invalid = typeof TokenType.Invalid;
  type After = typeof TokenType.After;
  type Array = typeof TokenType.Array;
  type AssertException = typeof TokenType.AssertException;
  type AssertExhaustion = typeof TokenType.AssertExhaustion;
  type AssertInvalid = typeof TokenType.AssertInvalid;
  type AssertMalformed = typeof TokenType.AssertMalformed;
  type AssertReturn = typeof TokenType.AssertReturn;
  type AssertTrap = typeof TokenType.AssertTrap;
  type AssertUnlinkable = typeof TokenType.AssertUnlinkable;
  type Before = typeof TokenType.Before;
  type Bin = typeof TokenType.Bin;
  type Item = typeof TokenType.Item;
  type Data = typeof TokenType.Data;
  type Declare = typeof TokenType.Declare;
  type Delegate = typeof TokenType.Delegate;
  type Do = typeof TokenType.Do;
  type Either = typeof TokenType.Either;
  type Elem = typeof TokenType.Elem;
  type Eof = typeof TokenType.Eof;
  type Tag = typeof TokenType.Tag;
  type Export = typeof TokenType.Export;
  type Field = typeof TokenType.Field;
  type Function = typeof TokenType.Function;
  type Get = typeof TokenType.Get;
  type Global = typeof TokenType.Global;
  type Import = typeof TokenType.Import;
  type Invoke = typeof TokenType.Invoke;
  type Input = typeof TokenType.Input;
  type Local = typeof TokenType.Local;
  type Lpar = typeof TokenType.Lpar;
  type Memory = typeof TokenType.Memory;
  type Module = typeof TokenType.Module;
  type Mut = typeof TokenType.Mut;
  type NanArithmetic = typeof TokenType.NanArithmetic;
  type NanCanonical = typeof TokenType.NanCanonical;
  type Null = typeof TokenType.Null;
  type Offset = typeof TokenType.Offset;
  type Output = typeof TokenType.Output;
  type PageSize = typeof TokenType.PageSize;
  type Param = typeof TokenType.Param;
  type Ref = typeof TokenType.Ref;
  type Quote = typeof TokenType.Quote;
  type Register = typeof TokenType.Register;
  type Result = typeof TokenType.Result;
  type Rpar = typeof TokenType.Rpar;
  type Shared = typeof TokenType.Shared;
  type Start = typeof TokenType.Start;
  type Struct = typeof TokenType.Struct;
  type Table = typeof TokenType.Table;
  type Then = typeof TokenType.Then;
  type Type = typeof TokenType.Type;
  type I8X16 = typeof TokenType.I8X16;
  type I16X8 = typeof TokenType.I16X8;
  type I32X4 = typeof TokenType.I32X4;
  type I64X2 = typeof TokenType.I64X2;
  type F32X4 = typeof TokenType.F32X4;
  type F64X2 = typeof TokenType.F64X2;
  type Float = typeof TokenType.Float;
  type Int = typeof TokenType.Int;
  type Nat = typeof TokenType.Nat;
  type AtomicFence = typeof TokenType.AtomicFence;
  type AtomicLoad = typeof TokenType.AtomicLoad;
  type AtomicNotify = typeof TokenType.AtomicNotify;
  type AtomicRmw = typeof TokenType.AtomicRmw;
  type AtomicRmwCmpxchg = typeof TokenType.AtomicRmwCmpxchg;
  type AtomicStore = typeof TokenType.AtomicStore;
  type AtomicWait = typeof TokenType.AtomicWait;
  type Binary = typeof TokenType.Binary;
  type Quaternary = typeof TokenType.Quaternary;
  type Block = typeof TokenType.Block;
  type Br = typeof TokenType.Br;
  type BrIf = typeof TokenType.BrIf;
  type HeapType = typeof TokenType.HeapType;
  type BrOnCast = typeof TokenType.BrOnCast;
  type BrOnCastFail = typeof TokenType.BrOnCastFail;
  type BrOnNonNull = typeof TokenType.BrOnNonNull;
  type BrOnNull = typeof TokenType.BrOnNull;
  type BrTable = typeof TokenType.BrTable;
  type Code = typeof TokenType.Code;
  type Call = typeof TokenType.Call;
  type CallIndirect = typeof TokenType.CallIndirect;
  type CallRef = typeof TokenType.CallRef;
  type ReturnCallRef = typeof TokenType.ReturnCallRef;
  type Catch = typeof TokenType.Catch;
  type CatchAll = typeof TokenType.CatchAll;
  type CatchRef = typeof TokenType.CatchRef;
  type CatchAllRef = typeof TokenType.CatchAllRef;
  type Compare = typeof TokenType.Compare;
  type Const = typeof TokenType.Const;
  type Convert = typeof TokenType.Convert;
  type DataDrop = typeof TokenType.DataDrop;
  type Drop = typeof TokenType.Drop;
  type ElemDrop = typeof TokenType.ElemDrop;
  type Else = typeof TokenType.Else;
  type End = typeof TokenType.End;
  type GlobalGet = typeof TokenType.GlobalGet;
  type GlobalSet = typeof TokenType.GlobalSet;
  type If = typeof TokenType.If;
  type Load = typeof TokenType.Load;
  type LocalGet = typeof TokenType.LocalGet;
  type LocalSet = typeof TokenType.LocalSet;
  type LocalTee = typeof TokenType.LocalTee;
  type Loop = typeof TokenType.Loop;
  type MemoryCopy = typeof TokenType.MemoryCopy;
  type MemoryFill = typeof TokenType.MemoryFill;
  type MemoryGrow = typeof TokenType.MemoryGrow;
  type MemoryInit = typeof TokenType.MemoryInit;
  type MemorySize = typeof TokenType.MemorySize;
  type Nop = typeof TokenType.Nop;
  type RefAsNonNull = typeof TokenType.RefAsNonNull;
  type RefEq = typeof TokenType.RefEq;
  type Rec = typeof TokenType.Rec;
  type Sub = typeof TokenType.Sub;
  type Final = typeof TokenType.Final;
  type Exact = typeof TokenType.Exact;
  type Descriptor = typeof TokenType.Descriptor;
  type Describes = typeof TokenType.Describes;
  type Definition = typeof TokenType.Definition;
  type Instance = typeof TokenType.Instance;
  type RefExtern = typeof TokenType.RefExtern;
  type RefHost = typeof TokenType.RefHost;
  type RefAny = typeof TokenType.RefAny;
  type RefStructKw = typeof TokenType.RefStructKw;
  type RefArrayKw = typeof TokenType.RefArrayKw;
  type RefFunc = typeof TokenType.RefFunc;
  type RefI31 = typeof TokenType.RefI31;
  type AnyConvertExtern = typeof TokenType.AnyConvertExtern;
  type ExternConvertAny = typeof TokenType.ExternConvertAny;
  type RefIsNull = typeof TokenType.RefIsNull;
  type RefNull = typeof TokenType.RefNull;
  type I31Get = typeof TokenType.I31Get;
  type StructNew = typeof TokenType.StructNew;
  type StructNewDefault = typeof TokenType.StructNewDefault;
  type StructGet = typeof TokenType.StructGet;
  type StructSet = typeof TokenType.StructSet;
  type ArrayNew = typeof TokenType.ArrayNew;
  type ArrayNewDefault = typeof TokenType.ArrayNewDefault;
  type ArrayNewFixed = typeof TokenType.ArrayNewFixed;
  type ArrayNewData = typeof TokenType.ArrayNewData;
  type ArrayNewElem = typeof TokenType.ArrayNewElem;
  type ArrayGet = typeof TokenType.ArrayGet;
  type ArraySet = typeof TokenType.ArraySet;
  type ArrayLen = typeof TokenType.ArrayLen;
  type ArrayFill = typeof TokenType.ArrayFill;
  type ArrayCopy = typeof TokenType.ArrayCopy;
  type ArrayInitData = typeof TokenType.ArrayInitData;
  type ArrayInitElem = typeof TokenType.ArrayInitElem;
  type RefTest = typeof TokenType.RefTest;
  type RefCast = typeof TokenType.RefCast;
  type StructNewDesc = typeof TokenType.StructNewDesc;
  type StructNewDefaultDesc = typeof TokenType.StructNewDefaultDesc;
  type RefGetDesc = typeof TokenType.RefGetDesc;
  type RefCastDescEq = typeof TokenType.RefCastDescEq;
  type BrOnCastDescEq = typeof TokenType.BrOnCastDescEq;
  type BrOnCastDescEqFail = typeof TokenType.BrOnCastDescEqFail;
  type Rethrow = typeof TokenType.Rethrow;
  type ReturnCallIndirect = typeof TokenType.ReturnCallIndirect;
  type ReturnCall = typeof TokenType.ReturnCall;
  type Return = typeof TokenType.Return;
  type Select = typeof TokenType.Select;
  type SimdLaneOp = typeof TokenType.SimdLaneOp;
  type SimdLoadSplat = typeof TokenType.SimdLoadSplat;
  type SimdLoadLane = typeof TokenType.SimdLoadLane;
  type SimdStoreLane = typeof TokenType.SimdStoreLane;
  type SimdShuffleOp = typeof TokenType.SimdShuffleOp;
  type Store = typeof TokenType.Store;
  type TableCopy = typeof TokenType.TableCopy;
  type TableFill = typeof TokenType.TableFill;
  type TableGet = typeof TokenType.TableGet;
  type TableGrow = typeof TokenType.TableGrow;
  type TableInit = typeof TokenType.TableInit;
  type TableSet = typeof TokenType.TableSet;
  type TableSize = typeof TokenType.TableSize;
  type Ternary = typeof TokenType.Ternary;
  type Throw = typeof TokenType.Throw;
  type ThrowRef = typeof TokenType.ThrowRef;
  type Try = typeof TokenType.Try;
  type TryTable = typeof TokenType.TryTable;
  type Unary = typeof TokenType.Unary;
  type Unreachable = typeof TokenType.Unreachable;
  type AlignEqNat = typeof TokenType.AlignEqNat;
  type LparAnn = typeof TokenType.LparAnn;
  type OffsetEqNat = typeof TokenType.OffsetEqNat;
  type Reserved = typeof TokenType.Reserved;
  type Text = typeof TokenType.Text;
  type Var = typeof TokenType.Var;
  type ValueType = typeof TokenType.ValueType;
  type Func = typeof TokenType.Func;
  type Extern = typeof TokenType.Extern;
  type Exn = typeof TokenType.Exn;
}

// Group boundaries (inclusive ranges matching token.def)
const FIRST_BARE = TokenType.Invalid;
const LAST_BARE = TokenType.F64X2;
const FIRST_LITERAL = TokenType.Float;
const LAST_LITERAL = TokenType.Nat;
const FIRST_OPCODE = TokenType.AtomicFence;
const LAST_OPCODE = TokenType.Unreachable;
const FIRST_STRING = TokenType.AlignEqNat;
const LAST_STRING = TokenType.Var;
const FIRST_TYPE = TokenType.ValueType;
const LAST_TYPE = TokenType.ValueType;
const FIRST_REFKIND = TokenType.Func;
const LAST_REFKIND = TokenType.Exn;

export function isBareToken(t: TokenType): boolean {
  return t >= FIRST_BARE && t <= LAST_BARE;
}
export function isLiteralToken(t: TokenType): boolean {
  return t >= FIRST_LITERAL && t <= LAST_LITERAL;
}
export function isOpcodeToken(t: TokenType): boolean {
  return t >= FIRST_OPCODE && t <= LAST_OPCODE;
}
export function isStringToken(t: TokenType): boolean {
  return t >= FIRST_STRING && t <= LAST_STRING;
}
export function isTypeToken(t: TokenType): boolean {
  return t >= FIRST_TYPE && t <= LAST_TYPE;
}
export function isRefKindToken(t: TokenType): boolean {
  return t >= FIRST_REFKIND && t <= LAST_REFKIND;
}

// ---------------------------------------------------------------------------
// Literal payload (numeric token text + LiteralType)
// ---------------------------------------------------------------------------

/** Literal type tag, matching C++ LiteralType. */
export const LiteralType = {
  Int: 'int',
  Float: 'float',
  Hexfloat: 'hexfloat',
  Infinity: 'infinity',
  Nan: 'nan',
} as const;
/** One of {@link LiteralType}'s values. */
export type LiteralType = (typeof LiteralType)[keyof typeof LiteralType];
/** Each member as a type (`LiteralType.Int`), as when LiteralType was an `enum`. */
export declare namespace LiteralType {
  type Int = typeof LiteralType.Int;
  type Float = typeof LiteralType.Float;
  type Hexfloat = typeof LiteralType.Hexfloat;
  type Infinity = typeof LiteralType.Infinity;
  type Nan = typeof LiteralType.Nan;
}

export interface LiteralPayload {
  literalType: LiteralType;
  text: string;
}

// ---------------------------------------------------------------------------
// Token discriminated union
// ---------------------------------------------------------------------------

interface TokenBase {
  readonly loc: Location;
  readonly tokenType: TokenType;
}

export interface BareToken extends TokenBase {
  readonly tokenType: TokenType; // bare range
}

export interface LiteralToken extends TokenBase {
  readonly tokenType: TokenType; // literal range
  readonly literal: LiteralPayload;
}

export interface OpcodeToken extends TokenBase {
  readonly tokenType: TokenType; // opcode range
  readonly opcode: Opcode;
}

export interface StringToken extends TokenBase {
  readonly tokenType: TokenType; // string range
  readonly text: string;
}

export interface TypeToken extends TokenBase {
  readonly tokenType: TokenType.ValueType;
  readonly valueType: Type;
}

/**
 * A bare abstract HEAP-type keyword: `any` / `eq` / `i31` / `none` / `nofunc`
 * / `noextern` / `noexn`.
 *
 * Deliberately NOT a {@link TypeToken}. These are heap types, legal only
 * inside `(ref [null] H)`, `ref.null H` and the cast immediates — the value
 * type is the `…ref` spelling. Lexing them as ValueType made
 * `(result any)` / `(param any)` / `(global any …)` parse, all of which the
 * spec rejects (ref.wast asserts `select (result any)` invalid).
 */
export interface HeapTypeToken extends TokenBase {
  readonly tokenType: TokenType.HeapType;
  readonly valueType: Type;
}

export interface RefKindToken extends TokenBase {
  readonly tokenType: TokenType; // refkind range
  /** `func` / `extern` / … as the nullable reference value type they abbreviate. */
  readonly refType: ValType;
}

export type Token = BareToken | LiteralToken | OpcodeToken | StringToken | TypeToken | RefKindToken;

// ---------------------------------------------------------------------------
// Token name table (for debugging/error messages)
// ---------------------------------------------------------------------------

const TOKEN_NAMES: ReadonlyMap<TokenType, string> = new Map([
  [TokenType.Invalid, 'Invalid'],
  [TokenType.After, 'after'],
  [TokenType.Array, 'array'],
  [TokenType.AssertException, 'assert_exception'],
  [TokenType.AssertExhaustion, 'assert_exhaustion'],
  [TokenType.AssertInvalid, 'assert_invalid'],
  [TokenType.AssertMalformed, 'assert_malformed'],
  [TokenType.AssertReturn, 'assert_return'],
  [TokenType.AssertTrap, 'assert_trap'],
  [TokenType.AssertUnlinkable, 'assert_unlinkable'],
  [TokenType.Before, 'before'],
  [TokenType.Bin, 'bin'],
  [TokenType.Item, 'item'],
  [TokenType.Data, 'data'],
  [TokenType.Declare, 'declare'],
  [TokenType.Delegate, 'delegate'],
  [TokenType.Do, 'do'],
  [TokenType.Either, 'either'],
  [TokenType.Elem, 'elem'],
  [TokenType.Eof, 'EOF'],
  [TokenType.Tag, 'tag'],
  [TokenType.Export, 'export'],
  [TokenType.Field, 'field'],
  [TokenType.Function, 'function'],
  [TokenType.Get, 'get'],
  [TokenType.Global, 'global'],
  [TokenType.Import, 'import'],
  [TokenType.Invoke, 'invoke'],
  [TokenType.Input, 'input'],
  [TokenType.Local, 'local'],
  [TokenType.Lpar, '('],
  [TokenType.Memory, 'memory'],
  [TokenType.Module, 'module'],
  [TokenType.Mut, 'mut'],
  [TokenType.NanArithmetic, 'nan:arithmetic'],
  [TokenType.NanCanonical, 'nan:canonical'],
  [TokenType.Null, 'null'],
  [TokenType.Offset, 'offset'],
  [TokenType.Output, 'output'],
  [TokenType.PageSize, 'pagesize'],
  [TokenType.Param, 'param'],
  [TokenType.Ref, 'ref'],
  [TokenType.Quote, 'quote'],
  [TokenType.Register, 'register'],
  [TokenType.Result, 'result'],
  [TokenType.Rpar, ')'],
  [TokenType.Shared, 'shared'],
  [TokenType.Start, 'start'],
  [TokenType.Struct, 'struct'],
  [TokenType.Table, 'table'],
  [TokenType.Then, 'then'],
  [TokenType.Type, 'type'],
  [TokenType.I8X16, 'i8x16'],
  [TokenType.I16X8, 'i16x8'],
  [TokenType.I32X4, 'i32x4'],
  [TokenType.I64X2, 'i64x2'],
  [TokenType.F32X4, 'f32x4'],
  [TokenType.F64X2, 'f64x2'],
  [TokenType.Float, 'FLOAT'],
  [TokenType.Int, 'INT'],
  [TokenType.Nat, 'NAT'],
  [TokenType.AtomicFence, 'atomic.fence'],
  [TokenType.AtomicLoad, 'ATOMIC_LOAD'],
  [TokenType.AtomicNotify, 'ATOMIC_NOTIFY'],
  [TokenType.AtomicRmw, 'ATOMIC_RMW'],
  [TokenType.AtomicRmwCmpxchg, 'ATOMIC_RMW_CMPXCHG'],
  [TokenType.AtomicStore, 'ATOMIC_STORE'],
  [TokenType.AtomicWait, 'ATOMIC_WAIT'],
  [TokenType.Binary, 'BINARY'],
  [TokenType.Quaternary, 'QUATERNARY'],
  [TokenType.Block, 'block'],
  [TokenType.Br, 'br'],
  [TokenType.BrIf, 'br_if'],
  [TokenType.HeapType, 'heaptype'],
  [TokenType.BrOnCast, 'br_on_cast'],
  [TokenType.BrOnCastFail, 'br_on_cast_fail'],
  [TokenType.BrOnNonNull, 'br_on_non_null'],
  [TokenType.BrOnNull, 'br_on_null'],
  [TokenType.BrTable, 'br_table'],
  [TokenType.Code, 'code'],
  [TokenType.Call, 'call'],
  [TokenType.CallIndirect, 'call_indirect'],
  [TokenType.CallRef, 'call_ref'],
  [TokenType.ReturnCallRef, 'return_call_ref'],
  [TokenType.Catch, 'catch'],
  [TokenType.CatchAll, 'catch_all'],
  [TokenType.CatchRef, 'catch_ref'],
  [TokenType.CatchAllRef, 'catch_all_ref'],
  [TokenType.Compare, 'COMPARE'],
  [TokenType.Const, 'CONST'],
  [TokenType.Convert, 'CONVERT'],
  [TokenType.DataDrop, 'data.drop'],
  [TokenType.Drop, 'drop'],
  [TokenType.ElemDrop, 'elem.drop'],
  [TokenType.Else, 'else'],
  [TokenType.End, 'end'],
  [TokenType.GlobalGet, 'global.get'],
  [TokenType.GlobalSet, 'global.set'],
  [TokenType.If, 'if'],
  [TokenType.Load, 'LOAD'],
  [TokenType.LocalGet, 'local.get'],
  [TokenType.LocalSet, 'local.set'],
  [TokenType.LocalTee, 'local.tee'],
  [TokenType.Loop, 'loop'],
  [TokenType.MemoryCopy, 'memory.copy'],
  [TokenType.MemoryFill, 'memory.fill'],
  [TokenType.MemoryGrow, 'memory.grow'],
  [TokenType.MemoryInit, 'memory.init'],
  [TokenType.MemorySize, 'memory.size'],
  [TokenType.Nop, 'nop'],
  [TokenType.RefAsNonNull, 'ref.as_non_null'],
  [TokenType.RefEq, 'ref.eq'],
  [TokenType.Rec, 'rec'],
  [TokenType.Definition, 'definition'],
  [TokenType.Instance, 'instance'],
  [TokenType.Sub, 'sub'],
  [TokenType.Final, 'final'],
  [TokenType.Exact, 'exact'],
  [TokenType.Descriptor, 'descriptor'],
  [TokenType.Describes, 'describes'],
  [TokenType.RefExtern, 'ref.extern'],
  [TokenType.RefHost, 'ref.host'],
  [TokenType.RefAny, 'ref.any'],
  [TokenType.RefStructKw, 'ref.struct'],
  [TokenType.RefArrayKw, 'ref.array'],
  [TokenType.RefFunc, 'ref.func'],
  [TokenType.RefI31, 'ref.i31'],
  [TokenType.AnyConvertExtern, 'any.convert_extern'],
  [TokenType.ExternConvertAny, 'extern.convert_any'],
  [TokenType.RefIsNull, 'ref.is_null'],
  [TokenType.RefNull, 'ref.null'],
  [TokenType.I31Get, 'i31.get'],
  [TokenType.StructNew, 'struct.new'],
  [TokenType.StructNewDefault, 'struct.new_default'],
  [TokenType.StructGet, 'struct.get'],
  [TokenType.StructSet, 'struct.set'],
  [TokenType.ArrayNew, 'array.new'],
  [TokenType.ArrayNewDefault, 'array.new_default'],
  [TokenType.ArrayNewFixed, 'array.new_fixed'],
  [TokenType.ArrayNewData, 'array.new_data'],
  [TokenType.ArrayNewElem, 'array.new_elem'],
  [TokenType.ArrayGet, 'array.get'],
  [TokenType.ArraySet, 'array.set'],
  [TokenType.ArrayLen, 'array.len'],
  [TokenType.ArrayFill, 'array.fill'],
  [TokenType.ArrayCopy, 'array.copy'],
  [TokenType.ArrayInitData, 'array.init_data'],
  [TokenType.ArrayInitElem, 'array.init_elem'],
  [TokenType.RefTest, 'ref.test'],
  [TokenType.RefCast, 'ref.cast'],
  [TokenType.StructNewDesc, 'struct.new_desc'],
  [TokenType.StructNewDefaultDesc, 'struct.new_default_desc'],
  [TokenType.RefGetDesc, 'ref.get_desc'],
  [TokenType.RefCastDescEq, 'ref.cast_desc_eq'],
  [TokenType.BrOnCastDescEq, 'br_on_cast_desc_eq'],
  [TokenType.BrOnCastDescEqFail, 'br_on_cast_desc_eq_fail'],
  [TokenType.Rethrow, 'rethrow'],
  [TokenType.ReturnCallIndirect, 'return_call_indirect'],
  [TokenType.ReturnCall, 'return_call'],
  [TokenType.Return, 'return'],
  [TokenType.Select, 'select'],
  [TokenType.SimdLaneOp, 'SIMDLANEOP'],
  [TokenType.SimdLoadSplat, 'SIMDLOADSPLAT'],
  [TokenType.SimdLoadLane, 'SIMDLOADLANE'],
  [TokenType.SimdStoreLane, 'SIMDSTORELANE'],
  [TokenType.SimdShuffleOp, 'i8x16.shuffle'],
  [TokenType.Store, 'STORE'],
  [TokenType.TableCopy, 'table.copy'],
  [TokenType.TableFill, 'table.fill'],
  [TokenType.TableGet, 'table.get'],
  [TokenType.TableGrow, 'table.grow'],
  [TokenType.TableInit, 'table.init'],
  [TokenType.TableSet, 'table.set'],
  [TokenType.TableSize, 'table.size'],
  [TokenType.Ternary, 'TERNARY'],
  [TokenType.Throw, 'throw'],
  [TokenType.ThrowRef, 'throw_ref'],
  [TokenType.Try, 'try'],
  [TokenType.TryTable, 'try_table'],
  [TokenType.Unary, 'UNARY'],
  [TokenType.Unreachable, 'unreachable'],
  [TokenType.AlignEqNat, 'align='],
  [TokenType.LparAnn, 'Annotation'],
  [TokenType.OffsetEqNat, 'offset='],
  [TokenType.Reserved, 'Reserved'],
  [TokenType.Text, 'TEXT'],
  [TokenType.Var, 'VAR'],
  [TokenType.ValueType, 'VALUETYPE'],
  [TokenType.Func, 'func'],
  [TokenType.Extern, 'extern'],
  [TokenType.Exn, 'exn'],
]);

export function tokenTypeName(t: TokenType): string {
  // TOKEN_NAMES covers every TokenType member, so the fallback is unreachable
  // in practice — it exists only so a newly-added member degrades to an
  // ordinal instead of `undefined`. `TokenType` is a `const enum`, so there is
  // no runtime reverse mapping to fall back to; a new member must be added to
  // the map above.
  return TOKEN_NAMES.get(t) ?? `<unknown:${t}>`;
}
