// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/token.h, include/wabt/token.def
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import type { Location } from '../core/error.ts';
import type { Opcode } from '../core/opcode.ts';
import { Type } from '../core/types.ts';

// ---------------------------------------------------------------------------
// TokenType — mirrors token.def groups
// ---------------------------------------------------------------------------

/** All token kinds, grouped to match token.def semantics. */
export const enum TokenType {
  // --- Bare (no payload) ---
  Invalid = 0,
  After,
  Array,
  AssertException,
  AssertExhaustion,
  AssertInvalid,
  AssertMalformed,
  AssertReturn,
  AssertTrap,
  AssertUnlinkable,
  Before,
  Bin,
  Item,
  Data,
  Declare,
  Delegate,
  Do,
  Either,
  Elem,
  Eof,
  Tag,
  Export,
  Field,
  Function,
  Get,
  Global,
  Import,
  Invoke,
  Input,
  Local,
  Lpar,
  Memory,
  Module,
  Mut,
  NanArithmetic,
  NanCanonical,
  Null,
  Offset,
  Output,
  PageSize,
  Param,
  Ref,
  Quote,
  Register,
  Result,
  Rpar,
  Shared,
  Start,
  Struct,
  Table,
  Then,
  Type,
  I8X16,
  I16X8,
  I32X4,
  I64X2,
  F32X4,
  F64X2,

  // --- Literal (payload: LiteralToken) ---
  Float,
  Int,
  Nat,

  // --- Opcode (payload: OpcodeToken) ---
  AtomicFence,
  AtomicLoad,
  AtomicNotify,
  AtomicRmw,
  AtomicRmwCmpxchg,
  AtomicStore,
  AtomicWait,
  Binary,
  Quaternary,
  Block,
  Br,
  BrIf,
  BrOnNonNull,
  BrOnNull,
  BrTable,
  Code,
  Call,
  CallIndirect,
  CallRef,
  ReturnCallRef,
  Catch,
  CatchAll,
  CatchRef,
  CatchAllRef,
  Compare,
  Const,
  Convert,
  DataDrop,
  Drop,
  ElemDrop,
  Else,
  End,
  GlobalGet,
  GlobalSet,
  If,
  Load,
  LocalGet,
  LocalSet,
  LocalTee,
  Loop,
  MemoryCopy,
  MemoryFill,
  MemoryGrow,
  MemoryInit,
  MemorySize,
  Nop,
  RefAsNonNull,
  RefEq,
  RefExtern,
  RefFunc,
  RefI31,
  RefIsNull,
  RefNull,
  I31Get,
  StructNew,
  StructNewDefault,
  StructGet,
  StructSet,
  ArrayNew,
  ArrayNewDefault,
  ArrayNewFixed,
  ArrayNewData,
  ArrayNewElem,
  ArrayGet,
  ArraySet,
  ArrayLen,
  RefTest,
  RefCast,
  Rethrow,
  ReturnCallIndirect,
  ReturnCall,
  Return,
  Select,
  SimdLaneOp,
  SimdLoadSplat,
  SimdLoadLane,
  SimdStoreLane,
  SimdShuffleOp,
  Store,
  TableCopy,
  TableFill,
  TableGet,
  TableGrow,
  TableInit,
  TableSet,
  TableSize,
  Ternary,
  Throw,
  ThrowRef,
  Try,
  TryTable,
  Unary,
  Unreachable,

  // --- String (payload: string) ---
  AlignEqNat,
  LparAnn,
  OffsetEqNat,
  Reserved,
  Text,
  Var,

  // --- Type (payload: Type) ---
  ValueType,

  // --- RefKind (payload: Type for ref types) ---
  Func,
  Extern,
  Exn,
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
export const enum LiteralType {
  Int = 'int',
  Float = 'float',
  Hexfloat = 'hexfloat',
  Infinity = 'infinity',
  Nan = 'nan',
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

export interface RefKindToken extends TokenBase {
  readonly tokenType: TokenType; // refkind range
  readonly refType: Type;
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
  [TokenType.RefExtern, 'ref.extern'],
  [TokenType.RefFunc, 'ref.func'],
  [TokenType.RefI31, 'ref.i31'],
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
  [TokenType.RefTest, 'ref.test'],
  [TokenType.RefCast, 'ref.cast'],
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
  return TOKEN_NAMES.get(t) ?? `<unknown:${t}>`;
}
