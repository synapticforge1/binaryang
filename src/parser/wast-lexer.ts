// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/wast-lexer.h, src/wast-lexer.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WAT/WAST tokenizer.
 *
 * Converts a {@link LexerSource} into a stream of {@link Token} objects.
 * Handles WAT keywords, identifiers, string literals, numeric literals,
 * and line/block comments.
 */

import type { Location, WabtError } from '../core/error.ts';
import { ErrorLevel } from '../core/error.ts';
import {
  GcOpcode,
  MiscOpcode,
  Opcode,
  PREFIX_GC,
  PREFIX_MISC,
  PREFIX_SIMD,
  PREFIX_THREADS,
} from '../core/opcode.ts';
import { Type } from '../core/types.ts';
import { LexerSource } from './lexer-source.ts';
import { isRefKindToken, LiteralType, TokenType } from './token.ts';
import type { LiteralPayload, Token } from './token.ts';

// ---------------------------------------------------------------------------
// Keyword table
// ---------------------------------------------------------------------------

// Helper to form extended opcodes for the keyword map
const S = (n: number) => (PREFIX_SIMD << 8) | n;
const A = (n: number) => (PREFIX_THREADS << 8) | n;
const M = (n: number) => (PREFIX_MISC << 8) | n;
const G = (n: number) => (PREFIX_GC << 8) | n;

interface KwBare {
  readonly tt: TokenType;
}
interface KwOp {
  readonly tt: TokenType;
  readonly op: number;
}
interface KwType {
  readonly tt: TokenType;
  readonly vt: Type;
}
type KwInfo = KwBare | KwOp | KwType;

function bare(tt: TokenType): KwBare {
  return { tt };
}
function op(tt: TokenType, o: number): KwOp {
  return { tt, op: o };
}
function vt(tt: TokenType, v: Type): KwType {
  return { tt, vt: v };
}

/** Map from WAT keyword text to token info. */
const KEYWORDS: ReadonlyMap<string, KwInfo> = new Map<string, KwInfo>([
  // --- bare tokens ---
  ['after', bare(TokenType.After)],
  ['array', vt(TokenType.Array, Type.Array)],
  ['assert_exception', bare(TokenType.AssertException)],
  ['assert_exhaustion', bare(TokenType.AssertExhaustion)],
  ['assert_invalid', bare(TokenType.AssertInvalid)],
  ['assert_malformed', bare(TokenType.AssertMalformed)],
  ['assert_return', bare(TokenType.AssertReturn)],
  ['assert_trap', bare(TokenType.AssertTrap)],
  ['assert_unlinkable', bare(TokenType.AssertUnlinkable)],
  ['before', bare(TokenType.Before)],
  ['binary', bare(TokenType.Bin)],
  ['code', bare(TokenType.Code)],
  ['data', bare(TokenType.Data)],
  ['declare', bare(TokenType.Declare)],
  ['delegate', bare(TokenType.Delegate)],
  ['do', bare(TokenType.Do)],
  ['either', bare(TokenType.Either)],
  ['elem', bare(TokenType.Elem)],
  ['export', bare(TokenType.Export)],
  ['field', bare(TokenType.Field)],
  ['function', bare(TokenType.Function)],
  ['get', bare(TokenType.Get)],
  ['global', bare(TokenType.Global)],
  ['import', bare(TokenType.Import)],
  ['input', bare(TokenType.Input)],
  ['invoke', bare(TokenType.Invoke)],
  ['item', bare(TokenType.Item)],
  ['local', bare(TokenType.Local)],
  ['memory', bare(TokenType.Memory)],
  ['module', bare(TokenType.Module)],
  ['mut', bare(TokenType.Mut)],
  ['nan:arithmetic', bare(TokenType.NanArithmetic)],
  ['nan:canonical', bare(TokenType.NanCanonical)],
  ['null', bare(TokenType.Null)],
  ['offset', bare(TokenType.Offset)],
  ['output', bare(TokenType.Output)],
  ['pagesize', bare(TokenType.PageSize)],
  ['param', bare(TokenType.Param)],
  ['quote', bare(TokenType.Quote)],
  ['ref', bare(TokenType.Ref)],
  ['register', bare(TokenType.Register)],
  ['result', bare(TokenType.Result)],
  ['shared', bare(TokenType.Shared)],
  ['start', bare(TokenType.Start)],
  ['table', bare(TokenType.Table)],
  ['tag', bare(TokenType.Tag)],
  ['then', bare(TokenType.Then)],
  ['type', bare(TokenType.Type)],
  ['i8x16', bare(TokenType.I8X16)],
  ['i16x8', bare(TokenType.I16X8)],
  ['i32x4', bare(TokenType.I32X4)],
  ['i64x2', bare(TokenType.I64X2)],
  ['f32x4', bare(TokenType.F32X4)],
  ['f64x2', bare(TokenType.F64X2)],
  // --- refkind tokens ---
  ['func', vt(TokenType.Func, Type.FuncRef)],
  ['funcref', vt(TokenType.ValueType, Type.FuncRef)],
  ['extern', vt(TokenType.Extern, Type.ExternRef)],
  ['externref', vt(TokenType.ValueType, Type.ExternRef)],
  ['exn', vt(TokenType.Exn, Type.ExnRef)],
  ['exnref', vt(TokenType.ValueType, Type.ExnRef)],
  // GC abstract heap types (treated as full value types for `(local … X)` and
  // `(global … X)` slots, parallel to funcref/externref/exnref).
  ['anyref', vt(TokenType.ValueType, Type.AnyRef)],
  ['eqref', vt(TokenType.ValueType, Type.EqRef)],
  ['i31ref', vt(TokenType.ValueType, Type.I31Ref)],
  ['structref', vt(TokenType.ValueType, Type.StructRef)],
  ['arrayref', vt(TokenType.ValueType, Type.ArrayRef)],
  ['nullref', vt(TokenType.ValueType, Type.NullRef)],
  ['nullfuncref', vt(TokenType.ValueType, Type.NullFuncRef)],
  ['nullexternref', vt(TokenType.ValueType, Type.NullExternRef)],
  // --- value types ---
  ['i32', vt(TokenType.ValueType, Type.I32)],
  ['i64', vt(TokenType.ValueType, Type.I64)],
  ['f32', vt(TokenType.ValueType, Type.F32)],
  ['f64', vt(TokenType.ValueType, Type.F64)],
  ['v128', vt(TokenType.ValueType, Type.V128)],
  // GC packed types — valid only as struct/array field types; the lexer tags
  // them as ValueType so parseFieldType / parseValueType accept them. The
  // validator + binary writer route packed fields through their own paths.
  ['i8', vt(TokenType.ValueType, Type.I8)],
  ['i16', vt(TokenType.ValueType, Type.I16)],
  ['struct', vt(TokenType.Struct, Type.Struct)],
  // --- opcode tokens: control flow ---
  ['atomic.fence', op(TokenType.AtomicFence, A(0x03))],
  ['block', op(TokenType.Block, Opcode.Block)],
  ['br', op(TokenType.Br, Opcode.Br)],
  ['br_if', op(TokenType.BrIf, Opcode.BrIf)],
  ['br_on_non_null', op(TokenType.BrOnNonNull, Opcode.BrOnNonNull)],
  ['br_on_null', op(TokenType.BrOnNull, Opcode.BrOnNull)],
  ['br_table', op(TokenType.BrTable, Opcode.BrTable)],
  ['call', op(TokenType.Call, Opcode.Call)],
  ['call_indirect', op(TokenType.CallIndirect, Opcode.CallIndirect)],
  ['call_ref', op(TokenType.CallRef, Opcode.CallRef)],
  ['catch', op(TokenType.Catch, Opcode.Catch)],
  ['catch_all', op(TokenType.CatchAll, Opcode.CatchAll)],
  ['catch_ref', bare(TokenType.CatchRef)],
  ['catch_all_ref', bare(TokenType.CatchAllRef)],
  ['data.drop', op(TokenType.DataDrop, M(MiscOpcode.DataDrop))],
  ['drop', op(TokenType.Drop, Opcode.Drop)],
  ['elem.drop', op(TokenType.ElemDrop, M(MiscOpcode.ElemDrop))],
  ['else', op(TokenType.Else, Opcode.Else)],
  ['end', op(TokenType.End, Opcode.End)],
  ['global.get', op(TokenType.GlobalGet, Opcode.GlobalGet)],
  ['global.set', op(TokenType.GlobalSet, Opcode.GlobalSet)],
  ['if', op(TokenType.If, Opcode.If)],
  ['local.get', op(TokenType.LocalGet, Opcode.LocalGet)],
  ['local.set', op(TokenType.LocalSet, Opcode.LocalSet)],
  ['local.tee', op(TokenType.LocalTee, Opcode.LocalTee)],
  ['loop', op(TokenType.Loop, Opcode.Loop)],
  ['memory.atomic.notify', op(TokenType.AtomicNotify, A(0x00))],
  ['memory.atomic.wait32', op(TokenType.AtomicWait, A(0x01))],
  ['memory.atomic.wait64', op(TokenType.AtomicWait, A(0x02))],
  ['memory.copy', op(TokenType.MemoryCopy, M(MiscOpcode.MemoryCopy))],
  ['memory.fill', op(TokenType.MemoryFill, M(MiscOpcode.MemoryFill))],
  ['memory.grow', op(TokenType.MemoryGrow, Opcode.MemoryGrow)],
  ['memory.init', op(TokenType.MemoryInit, M(MiscOpcode.MemoryInit))],
  ['memory.size', op(TokenType.MemorySize, Opcode.MemorySize)],
  ['nop', op(TokenType.Nop, Opcode.Nop)],
  ['ref.as_non_null', op(TokenType.RefAsNonNull, Opcode.RefAsNonNull)],
  ['ref.eq', op(TokenType.RefEq, Opcode.RefEq)],
  ['ref.extern', bare(TokenType.RefExtern)],
  ['ref.func', op(TokenType.RefFunc, Opcode.RefFunc)],
  ['ref.i31', op(TokenType.RefI31, G(GcOpcode.RefI31))],
  ['ref.is_null', op(TokenType.RefIsNull, Opcode.RefIsNull)],
  ['ref.null', op(TokenType.RefNull, Opcode.RefNull)],
  ['i31.get_s', op(TokenType.I31Get, G(GcOpcode.I31GetS))],
  ['i31.get_u', op(TokenType.I31Get, G(GcOpcode.I31GetU))],
  ['struct.new', op(TokenType.StructNew, G(GcOpcode.StructNew))],
  ['struct.new_default', op(TokenType.StructNewDefault, G(GcOpcode.StructNewDefault))],
  ['struct.get', op(TokenType.StructGet, G(GcOpcode.StructGet))],
  ['struct.get_s', op(TokenType.StructGet, G(GcOpcode.StructGetS))],
  ['struct.get_u', op(TokenType.StructGet, G(GcOpcode.StructGetU))],
  ['struct.set', op(TokenType.StructSet, G(GcOpcode.StructSet))],
  ['rethrow', op(TokenType.Rethrow, Opcode.Rethrow)],
  ['return', op(TokenType.Return, Opcode.Return)],
  ['return_call', op(TokenType.ReturnCall, Opcode.ReturnCall)],
  ['return_call_indirect', op(TokenType.ReturnCallIndirect, Opcode.ReturnCallIndirect)],
  ['return_call_ref', op(TokenType.ReturnCallRef, Opcode.ReturnCallRef)],
  ['select', op(TokenType.Select, Opcode.Select)],
  ['table.copy', op(TokenType.TableCopy, M(MiscOpcode.TableCopy))],
  ['table.fill', op(TokenType.TableFill, M(MiscOpcode.TableFill))],
  ['table.get', op(TokenType.TableGet, Opcode.TableGet)],
  ['table.grow', op(TokenType.TableGrow, M(MiscOpcode.TableGrow))],
  ['table.init', op(TokenType.TableInit, M(MiscOpcode.TableInit))],
  ['table.set', op(TokenType.TableSet, Opcode.TableSet)],
  ['table.size', op(TokenType.TableSize, M(MiscOpcode.TableSize))],
  ['throw', op(TokenType.Throw, Opcode.Throw)],
  ['throw_ref', op(TokenType.ThrowRef, Opcode.ThrowRef)],
  ['try', op(TokenType.Try, Opcode.Try)],
  ['try_table', op(TokenType.TryTable, Opcode.TryTable)],
  ['unreachable', op(TokenType.Unreachable, Opcode.Unreachable)],
  // --- i32 ---
  ['i32.const', op(TokenType.Const, Opcode.I32Const)],
  ['i32.load', op(TokenType.Load, Opcode.I32Load)],
  ['i32.load8_s', op(TokenType.Load, Opcode.I32Load8S)],
  ['i32.load8_u', op(TokenType.Load, Opcode.I32Load8U)],
  ['i32.load16_s', op(TokenType.Load, Opcode.I32Load16S)],
  ['i32.load16_u', op(TokenType.Load, Opcode.I32Load16U)],
  ['i32.store', op(TokenType.Store, Opcode.I32Store)],
  ['i32.store8', op(TokenType.Store, Opcode.I32Store8)],
  ['i32.store16', op(TokenType.Store, Opcode.I32Store16)],
  ['i32.add', op(TokenType.Binary, Opcode.I32Add)],
  ['i32.sub', op(TokenType.Binary, Opcode.I32Sub)],
  ['i32.mul', op(TokenType.Binary, Opcode.I32Mul)],
  ['i32.div_s', op(TokenType.Binary, Opcode.I32DivS)],
  ['i32.div_u', op(TokenType.Binary, Opcode.I32DivU)],
  ['i32.rem_s', op(TokenType.Binary, Opcode.I32RemS)],
  ['i32.rem_u', op(TokenType.Binary, Opcode.I32RemU)],
  ['i32.and', op(TokenType.Binary, Opcode.I32And)],
  ['i32.or', op(TokenType.Binary, Opcode.I32Or)],
  ['i32.xor', op(TokenType.Binary, Opcode.I32Xor)],
  ['i32.shl', op(TokenType.Binary, Opcode.I32Shl)],
  ['i32.shr_s', op(TokenType.Binary, Opcode.I32ShrS)],
  ['i32.shr_u', op(TokenType.Binary, Opcode.I32ShrU)],
  ['i32.rotl', op(TokenType.Binary, Opcode.I32Rotl)],
  ['i32.rotr', op(TokenType.Binary, Opcode.I32Rotr)],
  ['i32.clz', op(TokenType.Unary, Opcode.I32Clz)],
  ['i32.ctz', op(TokenType.Unary, Opcode.I32Ctz)],
  ['i32.popcnt', op(TokenType.Unary, Opcode.I32Popcnt)],
  ['i32.eq', op(TokenType.Compare, Opcode.I32Eq)],
  ['i32.ne', op(TokenType.Compare, Opcode.I32Ne)],
  ['i32.lt_s', op(TokenType.Compare, Opcode.I32LtS)],
  ['i32.lt_u', op(TokenType.Compare, Opcode.I32LtU)],
  ['i32.gt_s', op(TokenType.Compare, Opcode.I32GtS)],
  ['i32.gt_u', op(TokenType.Compare, Opcode.I32GtU)],
  ['i32.le_s', op(TokenType.Compare, Opcode.I32LeS)],
  ['i32.le_u', op(TokenType.Compare, Opcode.I32LeU)],
  ['i32.ge_s', op(TokenType.Compare, Opcode.I32GeS)],
  ['i32.ge_u', op(TokenType.Compare, Opcode.I32GeU)],
  ['i32.eqz', op(TokenType.Convert, Opcode.I32Eqz)],
  ['i32.wrap_i64', op(TokenType.Convert, Opcode.I32WrapI64)],
  ['i32.trunc_f32_s', op(TokenType.Convert, Opcode.I32TruncF32S)],
  ['i32.trunc_f32_u', op(TokenType.Convert, Opcode.I32TruncF32U)],
  ['i32.trunc_f64_s', op(TokenType.Convert, Opcode.I32TruncF64S)],
  ['i32.trunc_f64_u', op(TokenType.Convert, Opcode.I32TruncF64U)],
  ['i32.reinterpret_f32', op(TokenType.Convert, Opcode.I32ReinterpretF32)],
  ['i32.extend8_s', op(TokenType.Unary, Opcode.I32Extend8S)],
  ['i32.extend16_s', op(TokenType.Unary, Opcode.I32Extend16S)],
  ['i32.trunc_sat_f32_s', op(TokenType.Convert, M(MiscOpcode.I32TruncSatF32S))],
  ['i32.trunc_sat_f32_u', op(TokenType.Convert, M(MiscOpcode.I32TruncSatF32U))],
  ['i32.trunc_sat_f64_s', op(TokenType.Convert, M(MiscOpcode.I32TruncSatF64S))],
  ['i32.trunc_sat_f64_u', op(TokenType.Convert, M(MiscOpcode.I32TruncSatF64U))],
  // --- i64 ---
  ['i64.const', op(TokenType.Const, Opcode.I64Const)],
  ['i64.load', op(TokenType.Load, Opcode.I64Load)],
  ['i64.load8_s', op(TokenType.Load, Opcode.I64Load8S)],
  ['i64.load8_u', op(TokenType.Load, Opcode.I64Load8U)],
  ['i64.load16_s', op(TokenType.Load, Opcode.I64Load16S)],
  ['i64.load16_u', op(TokenType.Load, Opcode.I64Load16U)],
  ['i64.load32_s', op(TokenType.Load, Opcode.I64Load32S)],
  ['i64.load32_u', op(TokenType.Load, Opcode.I64Load32U)],
  ['i64.store', op(TokenType.Store, Opcode.I64Store)],
  ['i64.store8', op(TokenType.Store, Opcode.I64Store8)],
  ['i64.store16', op(TokenType.Store, Opcode.I64Store16)],
  ['i64.store32', op(TokenType.Store, Opcode.I64Store32)],
  ['i64.add', op(TokenType.Binary, Opcode.I64Add)],
  ['i64.sub', op(TokenType.Binary, Opcode.I64Sub)],
  ['i64.mul', op(TokenType.Binary, Opcode.I64Mul)],
  ['i64.div_s', op(TokenType.Binary, Opcode.I64DivS)],
  ['i64.div_u', op(TokenType.Binary, Opcode.I64DivU)],
  ['i64.rem_s', op(TokenType.Binary, Opcode.I64RemS)],
  ['i64.rem_u', op(TokenType.Binary, Opcode.I64RemU)],
  ['i64.and', op(TokenType.Binary, Opcode.I64And)],
  ['i64.or', op(TokenType.Binary, Opcode.I64Or)],
  ['i64.xor', op(TokenType.Binary, Opcode.I64Xor)],
  ['i64.shl', op(TokenType.Binary, Opcode.I64Shl)],
  ['i64.shr_s', op(TokenType.Binary, Opcode.I64ShrS)],
  ['i64.shr_u', op(TokenType.Binary, Opcode.I64ShrU)],
  ['i64.rotl', op(TokenType.Binary, Opcode.I64Rotl)],
  ['i64.rotr', op(TokenType.Binary, Opcode.I64Rotr)],
  ['i64.clz', op(TokenType.Unary, Opcode.I64Clz)],
  ['i64.ctz', op(TokenType.Unary, Opcode.I64Ctz)],
  ['i64.popcnt', op(TokenType.Unary, Opcode.I64Popcnt)],
  ['i64.eq', op(TokenType.Compare, Opcode.I64Eq)],
  ['i64.ne', op(TokenType.Compare, Opcode.I64Ne)],
  ['i64.lt_s', op(TokenType.Compare, Opcode.I64LtS)],
  ['i64.lt_u', op(TokenType.Compare, Opcode.I64LtU)],
  ['i64.gt_s', op(TokenType.Compare, Opcode.I64GtS)],
  ['i64.gt_u', op(TokenType.Compare, Opcode.I64GtU)],
  ['i64.le_s', op(TokenType.Compare, Opcode.I64LeS)],
  ['i64.le_u', op(TokenType.Compare, Opcode.I64LeU)],
  ['i64.ge_s', op(TokenType.Compare, Opcode.I64GeS)],
  ['i64.ge_u', op(TokenType.Compare, Opcode.I64GeU)],
  ['i64.eqz', op(TokenType.Convert, Opcode.I64Eqz)],
  ['i64.extend_i32_s', op(TokenType.Convert, Opcode.I64ExtendI32S)],
  ['i64.extend_i32_u', op(TokenType.Convert, Opcode.I64ExtendI32U)],
  ['i64.trunc_f32_s', op(TokenType.Convert, Opcode.I64TruncF32S)],
  ['i64.trunc_f32_u', op(TokenType.Convert, Opcode.I64TruncF32U)],
  ['i64.trunc_f64_s', op(TokenType.Convert, Opcode.I64TruncF64S)],
  ['i64.trunc_f64_u', op(TokenType.Convert, Opcode.I64TruncF64U)],
  ['i64.reinterpret_f64', op(TokenType.Convert, Opcode.I64ReinterpretF64)],
  ['i64.extend8_s', op(TokenType.Unary, Opcode.I64Extend8S)],
  ['i64.extend16_s', op(TokenType.Unary, Opcode.I64Extend16S)],
  ['i64.extend32_s', op(TokenType.Unary, Opcode.I64Extend32S)],
  ['i64.trunc_sat_f32_s', op(TokenType.Convert, M(MiscOpcode.I64TruncSatF32S))],
  ['i64.trunc_sat_f32_u', op(TokenType.Convert, M(MiscOpcode.I64TruncSatF32U))],
  ['i64.trunc_sat_f64_s', op(TokenType.Convert, M(MiscOpcode.I64TruncSatF64S))],
  ['i64.trunc_sat_f64_u', op(TokenType.Convert, M(MiscOpcode.I64TruncSatF64U))],
  // Wide arithmetic (0xfc group)
  ['i64.add128', op(TokenType.Quaternary, M(0x13))],
  ['i64.sub128', op(TokenType.Quaternary, M(0x14))],
  ['i64.mul_wide_s', op(TokenType.Binary, M(0x15))],
  ['i64.mul_wide_u', op(TokenType.Binary, M(0x16))],
  // --- f32 ---
  ['f32.const', op(TokenType.Const, Opcode.F32Const)],
  ['f32.load', op(TokenType.Load, Opcode.F32Load)],
  ['f32.store', op(TokenType.Store, Opcode.F32Store)],
  ['f32.add', op(TokenType.Binary, Opcode.F32Add)],
  ['f32.sub', op(TokenType.Binary, Opcode.F32Sub)],
  ['f32.mul', op(TokenType.Binary, Opcode.F32Mul)],
  ['f32.div', op(TokenType.Binary, Opcode.F32Div)],
  ['f32.min', op(TokenType.Binary, Opcode.F32Min)],
  ['f32.max', op(TokenType.Binary, Opcode.F32Max)],
  ['f32.copysign', op(TokenType.Binary, Opcode.F32Copysign)],
  ['f32.abs', op(TokenType.Unary, Opcode.F32Abs)],
  ['f32.neg', op(TokenType.Unary, Opcode.F32Neg)],
  ['f32.ceil', op(TokenType.Unary, Opcode.F32Ceil)],
  ['f32.floor', op(TokenType.Unary, Opcode.F32Floor)],
  ['f32.trunc', op(TokenType.Unary, Opcode.F32Trunc)],
  ['f32.nearest', op(TokenType.Unary, Opcode.F32Nearest)],
  ['f32.sqrt', op(TokenType.Unary, Opcode.F32Sqrt)],
  ['f32.eq', op(TokenType.Compare, Opcode.F32Eq)],
  ['f32.ne', op(TokenType.Compare, Opcode.F32Ne)],
  ['f32.lt', op(TokenType.Compare, Opcode.F32Lt)],
  ['f32.gt', op(TokenType.Compare, Opcode.F32Gt)],
  ['f32.le', op(TokenType.Compare, Opcode.F32Le)],
  ['f32.ge', op(TokenType.Compare, Opcode.F32Ge)],
  ['f32.convert_i32_s', op(TokenType.Convert, Opcode.F32ConvertI32S)],
  ['f32.convert_i32_u', op(TokenType.Convert, Opcode.F32ConvertI32U)],
  ['f32.convert_i64_s', op(TokenType.Convert, Opcode.F32ConvertI64S)],
  ['f32.convert_i64_u', op(TokenType.Convert, Opcode.F32ConvertI64U)],
  ['f32.demote_f64', op(TokenType.Convert, Opcode.F32DemoteF64)],
  ['f32.reinterpret_i32', op(TokenType.Convert, Opcode.F32ReinterpretI32)],
  // --- f64 ---
  ['f64.const', op(TokenType.Const, Opcode.F64Const)],
  ['f64.load', op(TokenType.Load, Opcode.F64Load)],
  ['f64.store', op(TokenType.Store, Opcode.F64Store)],
  ['f64.add', op(TokenType.Binary, Opcode.F64Add)],
  ['f64.sub', op(TokenType.Binary, Opcode.F64Sub)],
  ['f64.mul', op(TokenType.Binary, Opcode.F64Mul)],
  ['f64.div', op(TokenType.Binary, Opcode.F64Div)],
  ['f64.min', op(TokenType.Binary, Opcode.F64Min)],
  ['f64.max', op(TokenType.Binary, Opcode.F64Max)],
  ['f64.copysign', op(TokenType.Binary, Opcode.F64Copysign)],
  ['f64.abs', op(TokenType.Unary, Opcode.F64Abs)],
  ['f64.neg', op(TokenType.Unary, Opcode.F64Neg)],
  ['f64.ceil', op(TokenType.Unary, Opcode.F64Ceil)],
  ['f64.floor', op(TokenType.Unary, Opcode.F64Floor)],
  ['f64.trunc', op(TokenType.Unary, Opcode.F64Trunc)],
  ['f64.nearest', op(TokenType.Unary, Opcode.F64Nearest)],
  ['f64.sqrt', op(TokenType.Unary, Opcode.F64Sqrt)],
  ['f64.eq', op(TokenType.Compare, Opcode.F64Eq)],
  ['f64.ne', op(TokenType.Compare, Opcode.F64Ne)],
  ['f64.lt', op(TokenType.Compare, Opcode.F64Lt)],
  ['f64.gt', op(TokenType.Compare, Opcode.F64Gt)],
  ['f64.le', op(TokenType.Compare, Opcode.F64Le)],
  ['f64.ge', op(TokenType.Compare, Opcode.F64Ge)],
  ['f64.convert_i32_s', op(TokenType.Convert, Opcode.F64ConvertI32S)],
  ['f64.convert_i32_u', op(TokenType.Convert, Opcode.F64ConvertI32U)],
  ['f64.convert_i64_s', op(TokenType.Convert, Opcode.F64ConvertI64S)],
  ['f64.convert_i64_u', op(TokenType.Convert, Opcode.F64ConvertI64U)],
  ['f64.promote_f32', op(TokenType.Convert, Opcode.F64PromoteF32)],
  ['f64.reinterpret_i64', op(TokenType.Convert, Opcode.F64ReinterpretI64)],
  // --- v128 / SIMD ---
  ['v128.const', op(TokenType.Const, S(0x0c))],
  ['v128.load', op(TokenType.Load, S(0x00))],
  ['v128.load8x8_s', op(TokenType.Load, S(0x01))],
  ['v128.load8x8_u', op(TokenType.Load, S(0x02))],
  ['v128.load16x4_s', op(TokenType.Load, S(0x03))],
  ['v128.load16x4_u', op(TokenType.Load, S(0x04))],
  ['v128.load32x2_s', op(TokenType.Load, S(0x05))],
  ['v128.load32x2_u', op(TokenType.Load, S(0x06))],
  ['v128.load8_splat', op(TokenType.Load, S(0x07))],
  ['v128.load16_splat', op(TokenType.Load, S(0x08))],
  ['v128.load32_splat', op(TokenType.Load, S(0x09))],
  ['v128.load64_splat', op(TokenType.Load, S(0x0a))],
  ['v128.store', op(TokenType.Store, S(0x0b))],
  ['v128.load8_lane', op(TokenType.SimdLoadLane, S(0x54))],
  ['v128.load16_lane', op(TokenType.SimdLoadLane, S(0x55))],
  ['v128.load32_lane', op(TokenType.SimdLoadLane, S(0x56))],
  ['v128.load64_lane', op(TokenType.SimdLoadLane, S(0x57))],
  ['v128.store8_lane', op(TokenType.SimdStoreLane, S(0x58))],
  ['v128.store16_lane', op(TokenType.SimdStoreLane, S(0x59))],
  ['v128.store32_lane', op(TokenType.SimdStoreLane, S(0x5a))],
  ['v128.store64_lane', op(TokenType.SimdStoreLane, S(0x5b))],
  ['v128.load32_zero', op(TokenType.Load, S(0x5c))],
  ['v128.load64_zero', op(TokenType.Load, S(0x5d))],
  ['v128.not', op(TokenType.Unary, S(0x4d))],
  ['v128.and', op(TokenType.Binary, S(0x4e))],
  ['v128.andnot', op(TokenType.Binary, S(0x4f))],
  ['v128.or', op(TokenType.Binary, S(0x50))],
  ['v128.xor', op(TokenType.Binary, S(0x51))],
  ['v128.bitselect', op(TokenType.Ternary, S(0x52))],
  ['v128.any_true', op(TokenType.Unary, S(0x53))],
  ['i8x16.shuffle', op(TokenType.SimdShuffleOp, S(0x0d))],
  ['i8x16.swizzle', op(TokenType.Binary, S(0x0e))],
  ['i8x16.splat', op(TokenType.Unary, S(0x0f))],
  ['i8x16.extract_lane_s', op(TokenType.SimdLaneOp, S(0x15))],
  ['i8x16.extract_lane_u', op(TokenType.SimdLaneOp, S(0x16))],
  ['i8x16.replace_lane', op(TokenType.SimdLaneOp, S(0x17))],
  ['i8x16.eq', op(TokenType.Compare, S(0x23))],
  ['i8x16.ne', op(TokenType.Compare, S(0x24))],
  ['i8x16.lt_s', op(TokenType.Compare, S(0x25))],
  ['i8x16.lt_u', op(TokenType.Compare, S(0x26))],
  ['i8x16.gt_s', op(TokenType.Compare, S(0x27))],
  ['i8x16.gt_u', op(TokenType.Compare, S(0x28))],
  ['i8x16.le_s', op(TokenType.Compare, S(0x29))],
  ['i8x16.le_u', op(TokenType.Compare, S(0x2a))],
  ['i8x16.ge_s', op(TokenType.Compare, S(0x2b))],
  ['i8x16.ge_u', op(TokenType.Compare, S(0x2c))],
  ['i8x16.abs', op(TokenType.Unary, S(0x60))],
  ['i8x16.neg', op(TokenType.Unary, S(0x61))],
  ['i8x16.popcnt', op(TokenType.Unary, S(0x62))],
  ['i8x16.all_true', op(TokenType.Unary, S(0x63))],
  ['i8x16.bitmask', op(TokenType.Unary, S(0x64))],
  ['i8x16.narrow_i16x8_s', op(TokenType.Binary, S(0x65))],
  ['i8x16.narrow_i16x8_u', op(TokenType.Binary, S(0x66))],
  ['i8x16.shl', op(TokenType.Binary, S(0x6b))],
  ['i8x16.shr_s', op(TokenType.Binary, S(0x6c))],
  ['i8x16.shr_u', op(TokenType.Binary, S(0x6d))],
  ['i8x16.add', op(TokenType.Binary, S(0x6e))],
  ['i8x16.add_sat_s', op(TokenType.Binary, S(0x6f))],
  ['i8x16.add_sat_u', op(TokenType.Binary, S(0x70))],
  ['i8x16.sub', op(TokenType.Binary, S(0x71))],
  ['i8x16.sub_sat_s', op(TokenType.Binary, S(0x72))],
  ['i8x16.sub_sat_u', op(TokenType.Binary, S(0x73))],
  ['i8x16.min_s', op(TokenType.Binary, S(0x76))],
  ['i8x16.min_u', op(TokenType.Binary, S(0x77))],
  ['i8x16.max_s', op(TokenType.Binary, S(0x78))],
  ['i8x16.max_u', op(TokenType.Binary, S(0x79))],
  ['i8x16.avgr_u', op(TokenType.Binary, S(0x7b))],
  ['i8x16.relaxed_swizzle', op(TokenType.Binary, S(0x100))],
  ['i8x16.relaxed_laneselect', op(TokenType.Ternary, S(0x109))],
  ['i16x8.splat', op(TokenType.Unary, S(0x10))],
  ['i16x8.extract_lane_s', op(TokenType.SimdLaneOp, S(0x18))],
  ['i16x8.extract_lane_u', op(TokenType.SimdLaneOp, S(0x19))],
  ['i16x8.replace_lane', op(TokenType.SimdLaneOp, S(0x1a))],
  ['i16x8.eq', op(TokenType.Compare, S(0x2d))],
  ['i16x8.ne', op(TokenType.Compare, S(0x2e))],
  ['i16x8.lt_s', op(TokenType.Compare, S(0x2f))],
  ['i16x8.lt_u', op(TokenType.Compare, S(0x30))],
  ['i16x8.gt_s', op(TokenType.Compare, S(0x31))],
  ['i16x8.gt_u', op(TokenType.Compare, S(0x32))],
  ['i16x8.le_s', op(TokenType.Compare, S(0x33))],
  ['i16x8.le_u', op(TokenType.Compare, S(0x34))],
  ['i16x8.ge_s', op(TokenType.Compare, S(0x35))],
  ['i16x8.ge_u', op(TokenType.Compare, S(0x36))],
  ['i16x8.abs', op(TokenType.Unary, S(0x80))],
  ['i16x8.neg', op(TokenType.Unary, S(0x81))],
  ['i16x8.q15mulr_sat_s', op(TokenType.Binary, S(0x82))],
  ['i16x8.all_true', op(TokenType.Unary, S(0x83))],
  ['i16x8.bitmask', op(TokenType.Unary, S(0x84))],
  ['i16x8.narrow_i32x4_s', op(TokenType.Binary, S(0x85))],
  ['i16x8.narrow_i32x4_u', op(TokenType.Binary, S(0x86))],
  ['i16x8.extend_low_i8x16_s', op(TokenType.Unary, S(0x87))],
  ['i16x8.extend_high_i8x16_s', op(TokenType.Unary, S(0x88))],
  ['i16x8.extend_low_i8x16_u', op(TokenType.Unary, S(0x89))],
  ['i16x8.extend_high_i8x16_u', op(TokenType.Unary, S(0x8a))],
  ['i16x8.shl', op(TokenType.Binary, S(0x8b))],
  ['i16x8.shr_s', op(TokenType.Binary, S(0x8c))],
  ['i16x8.shr_u', op(TokenType.Binary, S(0x8d))],
  ['i16x8.add', op(TokenType.Binary, S(0x8e))],
  ['i16x8.add_sat_s', op(TokenType.Binary, S(0x8f))],
  ['i16x8.add_sat_u', op(TokenType.Binary, S(0x90))],
  ['i16x8.sub', op(TokenType.Binary, S(0x91))],
  ['i16x8.sub_sat_s', op(TokenType.Binary, S(0x92))],
  ['i16x8.sub_sat_u', op(TokenType.Binary, S(0x93))],
  ['i16x8.mul', op(TokenType.Binary, S(0x95))],
  ['i16x8.min_s', op(TokenType.Binary, S(0x96))],
  ['i16x8.min_u', op(TokenType.Binary, S(0x97))],
  ['i16x8.max_s', op(TokenType.Binary, S(0x98))],
  ['i16x8.max_u', op(TokenType.Binary, S(0x99))],
  ['i16x8.avgr_u', op(TokenType.Binary, S(0x9b))],
  ['i16x8.extmul_low_i8x16_s', op(TokenType.Binary, S(0x9c))],
  ['i16x8.extmul_high_i8x16_s', op(TokenType.Binary, S(0x9d))],
  ['i16x8.extmul_low_i8x16_u', op(TokenType.Binary, S(0x9e))],
  ['i16x8.extmul_high_i8x16_u', op(TokenType.Binary, S(0x9f))],
  ['i16x8.extadd_pairwise_i8x16_s', op(TokenType.Unary, S(0x7c))],
  ['i16x8.extadd_pairwise_i8x16_u', op(TokenType.Unary, S(0x7d))],
  ['i16x8.relaxed_q15mulr_s', op(TokenType.Binary, S(0x111))],
  ['i16x8.relaxed_dot_i8x16_i7x16_s', op(TokenType.Binary, S(0x112))],
  ['i16x8.relaxed_laneselect', op(TokenType.Ternary, S(0x10a))],
  ['i32x4.splat', op(TokenType.Unary, S(0x11))],
  ['i32x4.extract_lane', op(TokenType.SimdLaneOp, S(0x1b))],
  ['i32x4.replace_lane', op(TokenType.SimdLaneOp, S(0x1c))],
  ['i32x4.eq', op(TokenType.Compare, S(0x37))],
  ['i32x4.ne', op(TokenType.Compare, S(0x38))],
  ['i32x4.lt_s', op(TokenType.Compare, S(0x39))],
  ['i32x4.lt_u', op(TokenType.Compare, S(0x3a))],
  ['i32x4.gt_s', op(TokenType.Compare, S(0x3b))],
  ['i32x4.gt_u', op(TokenType.Compare, S(0x3c))],
  ['i32x4.le_s', op(TokenType.Compare, S(0x3d))],
  ['i32x4.le_u', op(TokenType.Compare, S(0x3e))],
  ['i32x4.ge_s', op(TokenType.Compare, S(0x3f))],
  ['i32x4.ge_u', op(TokenType.Compare, S(0x40))],
  ['i32x4.abs', op(TokenType.Unary, S(0xa0))],
  ['i32x4.neg', op(TokenType.Unary, S(0xa1))],
  ['i32x4.all_true', op(TokenType.Unary, S(0xa3))],
  ['i32x4.bitmask', op(TokenType.Unary, S(0xa4))],
  ['i32x4.extend_low_i16x8_s', op(TokenType.Unary, S(0xa7))],
  ['i32x4.extend_high_i16x8_s', op(TokenType.Unary, S(0xa8))],
  ['i32x4.extend_low_i16x8_u', op(TokenType.Unary, S(0xa9))],
  ['i32x4.extend_high_i16x8_u', op(TokenType.Unary, S(0xaa))],
  ['i32x4.shl', op(TokenType.Binary, S(0xab))],
  ['i32x4.shr_s', op(TokenType.Binary, S(0xac))],
  ['i32x4.shr_u', op(TokenType.Binary, S(0xad))],
  ['i32x4.add', op(TokenType.Binary, S(0xae))],
  ['i32x4.sub', op(TokenType.Binary, S(0xb1))],
  ['i32x4.mul', op(TokenType.Binary, S(0xb5))],
  ['i32x4.min_s', op(TokenType.Binary, S(0xb6))],
  ['i32x4.min_u', op(TokenType.Binary, S(0xb7))],
  ['i32x4.max_s', op(TokenType.Binary, S(0xb8))],
  ['i32x4.max_u', op(TokenType.Binary, S(0xb9))],
  ['i32x4.dot_i16x8_s', op(TokenType.Binary, S(0xba))],
  ['i32x4.extmul_low_i16x8_s', op(TokenType.Binary, S(0xbc))],
  ['i32x4.extmul_high_i16x8_s', op(TokenType.Binary, S(0xbd))],
  ['i32x4.extmul_low_i16x8_u', op(TokenType.Binary, S(0xbe))],
  ['i32x4.extmul_high_i16x8_u', op(TokenType.Binary, S(0xbf))],
  ['i32x4.extadd_pairwise_i16x8_s', op(TokenType.Unary, S(0x7e))],
  ['i32x4.extadd_pairwise_i16x8_u', op(TokenType.Unary, S(0x7f))],
  ['i32x4.trunc_sat_f32x4_s', op(TokenType.Unary, S(0xf8))],
  ['i32x4.trunc_sat_f32x4_u', op(TokenType.Unary, S(0xf9))],
  ['i32x4.trunc_sat_f64x2_s_zero', op(TokenType.Unary, S(0xfc))],
  ['i32x4.trunc_sat_f64x2_u_zero', op(TokenType.Unary, S(0xfd))],
  ['i32x4.relaxed_trunc_f32x4_s', op(TokenType.Unary, S(0x101))],
  ['i32x4.relaxed_trunc_f32x4_u', op(TokenType.Unary, S(0x102))],
  ['i32x4.relaxed_trunc_f64x2_s_zero', op(TokenType.Unary, S(0x103))],
  ['i32x4.relaxed_trunc_f64x2_u_zero', op(TokenType.Unary, S(0x104))],
  ['i32x4.relaxed_laneselect', op(TokenType.Ternary, S(0x10b))],
  ['i32x4.relaxed_dot_i8x16_i7x16_add_s', op(TokenType.Ternary, S(0x113))],
  ['i64x2.splat', op(TokenType.Unary, S(0x12))],
  ['i64x2.extract_lane', op(TokenType.SimdLaneOp, S(0x1d))],
  ['i64x2.replace_lane', op(TokenType.SimdLaneOp, S(0x1e))],
  ['i64x2.eq', op(TokenType.Binary, S(0xd6))],
  ['i64x2.ne', op(TokenType.Binary, S(0xd7))],
  ['i64x2.lt_s', op(TokenType.Binary, S(0xd8))],
  ['i64x2.gt_s', op(TokenType.Binary, S(0xd9))],
  ['i64x2.le_s', op(TokenType.Binary, S(0xda))],
  ['i64x2.ge_s', op(TokenType.Binary, S(0xdb))],
  ['i64x2.abs', op(TokenType.Unary, S(0xc0))],
  ['i64x2.neg', op(TokenType.Unary, S(0xc1))],
  ['i64x2.all_true', op(TokenType.Unary, S(0xc3))],
  ['i64x2.bitmask', op(TokenType.Unary, S(0xc4))],
  ['i64x2.extend_low_i32x4_s', op(TokenType.Unary, S(0xc7))],
  ['i64x2.extend_high_i32x4_s', op(TokenType.Unary, S(0xc8))],
  ['i64x2.extend_low_i32x4_u', op(TokenType.Unary, S(0xc9))],
  ['i64x2.extend_high_i32x4_u', op(TokenType.Unary, S(0xca))],
  ['i64x2.shl', op(TokenType.Binary, S(0xcb))],
  ['i64x2.shr_s', op(TokenType.Binary, S(0xcc))],
  ['i64x2.shr_u', op(TokenType.Binary, S(0xcd))],
  ['i64x2.add', op(TokenType.Binary, S(0xce))],
  ['i64x2.sub', op(TokenType.Binary, S(0xd1))],
  ['i64x2.mul', op(TokenType.Binary, S(0xd5))],
  ['i64x2.extmul_low_i32x4_s', op(TokenType.Binary, S(0xdc))],
  ['i64x2.extmul_high_i32x4_s', op(TokenType.Binary, S(0xdd))],
  ['i64x2.extmul_low_i32x4_u', op(TokenType.Binary, S(0xde))],
  ['i64x2.extmul_high_i32x4_u', op(TokenType.Binary, S(0xdf))],
  ['i64x2.relaxed_laneselect', op(TokenType.Ternary, S(0x10c))],
  ['f32x4.splat', op(TokenType.Unary, S(0x13))],
  ['f32x4.extract_lane', op(TokenType.SimdLaneOp, S(0x1f))],
  ['f32x4.replace_lane', op(TokenType.SimdLaneOp, S(0x20))],
  ['f32x4.eq', op(TokenType.Compare, S(0x41))],
  ['f32x4.ne', op(TokenType.Compare, S(0x42))],
  ['f32x4.lt', op(TokenType.Compare, S(0x43))],
  ['f32x4.gt', op(TokenType.Compare, S(0x44))],
  ['f32x4.le', op(TokenType.Compare, S(0x45))],
  ['f32x4.ge', op(TokenType.Compare, S(0x46))],
  ['f32x4.abs', op(TokenType.Unary, S(0xe0))],
  ['f32x4.neg', op(TokenType.Unary, S(0xe1))],
  ['f32x4.sqrt', op(TokenType.Unary, S(0xe3))],
  ['f32x4.ceil', op(TokenType.Unary, S(0xe7))],
  ['f32x4.floor', op(TokenType.Unary, S(0xe8))],
  ['f32x4.trunc', op(TokenType.Unary, S(0xe9))],
  ['f32x4.nearest', op(TokenType.Unary, S(0xea))],
  ['f32x4.add', op(TokenType.Binary, S(0xe4))],
  ['f32x4.sub', op(TokenType.Binary, S(0xe5))],
  ['f32x4.mul', op(TokenType.Binary, S(0xe6))],
  ['f32x4.div', op(TokenType.Binary, S(0xeb))],
  ['f32x4.min', op(TokenType.Binary, S(0xec))],
  ['f32x4.max', op(TokenType.Binary, S(0xed))],
  ['f32x4.pmin', op(TokenType.Binary, S(0xee))],
  ['f32x4.pmax', op(TokenType.Binary, S(0xef))],
  ['f32x4.convert_i32x4_s', op(TokenType.Unary, S(0xfa))],
  ['f32x4.convert_i32x4_u', op(TokenType.Unary, S(0xfb))],
  ['f32x4.demote_f64x2_zero', op(TokenType.Unary, S(0x5e))],
  ['f32x4.relaxed_madd', op(TokenType.Ternary, S(0x105))],
  ['f32x4.relaxed_nmadd', op(TokenType.Ternary, S(0x106))],
  ['f32x4.relaxed_min', op(TokenType.Binary, S(0x10d))],
  ['f32x4.relaxed_max', op(TokenType.Binary, S(0x10e))],
  ['f64x2.splat', op(TokenType.Unary, S(0x14))],
  ['f64x2.extract_lane', op(TokenType.SimdLaneOp, S(0x21))],
  ['f64x2.replace_lane', op(TokenType.SimdLaneOp, S(0x22))],
  ['f64x2.eq', op(TokenType.Compare, S(0x47))],
  ['f64x2.ne', op(TokenType.Compare, S(0x48))],
  ['f64x2.lt', op(TokenType.Compare, S(0x49))],
  ['f64x2.gt', op(TokenType.Compare, S(0x4a))],
  ['f64x2.le', op(TokenType.Compare, S(0x4b))],
  ['f64x2.ge', op(TokenType.Compare, S(0x4c))],
  ['f64x2.abs', op(TokenType.Unary, S(0xf0))],
  ['f64x2.neg', op(TokenType.Unary, S(0xf1))],
  ['f64x2.sqrt', op(TokenType.Unary, S(0xf3))],
  ['f64x2.ceil', op(TokenType.Unary, S(0xf8))],
  ['f64x2.floor', op(TokenType.Unary, S(0xf9))],
  ['f64x2.trunc', op(TokenType.Unary, S(0xfa))],
  ['f64x2.nearest', op(TokenType.Unary, S(0xfb))],
  ['f64x2.add', op(TokenType.Binary, S(0xf4))],
  ['f64x2.sub', op(TokenType.Binary, S(0xf5))],
  ['f64x2.mul', op(TokenType.Binary, S(0xf6))],
  ['f64x2.div', op(TokenType.Binary, S(0xf7))],
  ['f64x2.min', op(TokenType.Binary, S(0xfc))],
  ['f64x2.max', op(TokenType.Binary, S(0xfd))],
  ['f64x2.pmin', op(TokenType.Binary, S(0xfe))],
  ['f64x2.pmax', op(TokenType.Binary, S(0xff))],
  ['f64x2.convert_low_i32x4_s', op(TokenType.Unary, S(0xfe))],
  ['f64x2.convert_low_i32x4_u', op(TokenType.Unary, S(0xff))],
  ['f64x2.promote_low_f32x4', op(TokenType.Unary, S(0x5f))],
  ['f64x2.relaxed_madd', op(TokenType.Ternary, S(0x107))],
  ['f64x2.relaxed_nmadd', op(TokenType.Ternary, S(0x108))],
  ['f64x2.relaxed_min', op(TokenType.Binary, S(0x10f))],
  ['f64x2.relaxed_max', op(TokenType.Binary, S(0x110))],
  // --- atomics (0xfe prefix) ---
  ['i32.atomic.load', op(TokenType.AtomicLoad, A(0x10))],
  ['i32.atomic.load8_u', op(TokenType.AtomicLoad, A(0x12))],
  ['i32.atomic.load16_u', op(TokenType.AtomicLoad, A(0x13))],
  ['i64.atomic.load', op(TokenType.AtomicLoad, A(0x11))],
  ['i64.atomic.load8_u', op(TokenType.AtomicLoad, A(0x14))],
  ['i64.atomic.load16_u', op(TokenType.AtomicLoad, A(0x15))],
  ['i64.atomic.load32_u', op(TokenType.AtomicLoad, A(0x16))],
  ['i32.atomic.store', op(TokenType.AtomicStore, A(0x17))],
  ['i32.atomic.store8', op(TokenType.AtomicStore, A(0x19))],
  ['i32.atomic.store16', op(TokenType.AtomicStore, A(0x1a))],
  ['i64.atomic.store', op(TokenType.AtomicStore, A(0x18))],
  ['i64.atomic.store8', op(TokenType.AtomicStore, A(0x1b))],
  ['i64.atomic.store16', op(TokenType.AtomicStore, A(0x1c))],
  ['i64.atomic.store32', op(TokenType.AtomicStore, A(0x1d))],
  ['i32.atomic.rmw.add', op(TokenType.AtomicRmw, A(0x1e))],
  ['i64.atomic.rmw.add', op(TokenType.AtomicRmw, A(0x1f))],
  ['i32.atomic.rmw8.add_u', op(TokenType.AtomicRmw, A(0x20))],
  ['i32.atomic.rmw16.add_u', op(TokenType.AtomicRmw, A(0x21))],
  ['i64.atomic.rmw8.add_u', op(TokenType.AtomicRmw, A(0x22))],
  ['i64.atomic.rmw16.add_u', op(TokenType.AtomicRmw, A(0x23))],
  ['i64.atomic.rmw32.add_u', op(TokenType.AtomicRmw, A(0x24))],
  ['i32.atomic.rmw.sub', op(TokenType.AtomicRmw, A(0x25))],
  ['i64.atomic.rmw.sub', op(TokenType.AtomicRmw, A(0x26))],
  ['i32.atomic.rmw8.sub_u', op(TokenType.AtomicRmw, A(0x27))],
  ['i32.atomic.rmw16.sub_u', op(TokenType.AtomicRmw, A(0x28))],
  ['i64.atomic.rmw8.sub_u', op(TokenType.AtomicRmw, A(0x29))],
  ['i64.atomic.rmw16.sub_u', op(TokenType.AtomicRmw, A(0x2a))],
  ['i64.atomic.rmw32.sub_u', op(TokenType.AtomicRmw, A(0x2b))],
  ['i32.atomic.rmw.and', op(TokenType.AtomicRmw, A(0x2c))],
  ['i64.atomic.rmw.and', op(TokenType.AtomicRmw, A(0x2d))],
  ['i32.atomic.rmw8.and_u', op(TokenType.AtomicRmw, A(0x2e))],
  ['i32.atomic.rmw16.and_u', op(TokenType.AtomicRmw, A(0x2f))],
  ['i64.atomic.rmw8.and_u', op(TokenType.AtomicRmw, A(0x30))],
  ['i64.atomic.rmw16.and_u', op(TokenType.AtomicRmw, A(0x31))],
  ['i64.atomic.rmw32.and_u', op(TokenType.AtomicRmw, A(0x32))],
  ['i32.atomic.rmw.or', op(TokenType.AtomicRmw, A(0x33))],
  ['i64.atomic.rmw.or', op(TokenType.AtomicRmw, A(0x34))],
  ['i32.atomic.rmw8.or_u', op(TokenType.AtomicRmw, A(0x35))],
  ['i32.atomic.rmw16.or_u', op(TokenType.AtomicRmw, A(0x36))],
  ['i64.atomic.rmw8.or_u', op(TokenType.AtomicRmw, A(0x37))],
  ['i64.atomic.rmw16.or_u', op(TokenType.AtomicRmw, A(0x38))],
  ['i64.atomic.rmw32.or_u', op(TokenType.AtomicRmw, A(0x39))],
  ['i32.atomic.rmw.xor', op(TokenType.AtomicRmw, A(0x3a))],
  ['i64.atomic.rmw.xor', op(TokenType.AtomicRmw, A(0x3b))],
  ['i32.atomic.rmw8.xor_u', op(TokenType.AtomicRmw, A(0x3c))],
  ['i32.atomic.rmw16.xor_u', op(TokenType.AtomicRmw, A(0x3d))],
  ['i64.atomic.rmw8.xor_u', op(TokenType.AtomicRmw, A(0x3e))],
  ['i64.atomic.rmw16.xor_u', op(TokenType.AtomicRmw, A(0x3f))],
  ['i64.atomic.rmw32.xor_u', op(TokenType.AtomicRmw, A(0x40))],
  ['i32.atomic.rmw.xchg', op(TokenType.AtomicRmw, A(0x41))],
  ['i64.atomic.rmw.xchg', op(TokenType.AtomicRmw, A(0x42))],
  ['i32.atomic.rmw8.xchg_u', op(TokenType.AtomicRmw, A(0x43))],
  ['i32.atomic.rmw16.xchg_u', op(TokenType.AtomicRmw, A(0x44))],
  ['i64.atomic.rmw8.xchg_u', op(TokenType.AtomicRmw, A(0x45))],
  ['i64.atomic.rmw16.xchg_u', op(TokenType.AtomicRmw, A(0x46))],
  ['i64.atomic.rmw32.xchg_u', op(TokenType.AtomicRmw, A(0x47))],
  ['i32.atomic.rmw.cmpxchg', op(TokenType.AtomicRmwCmpxchg, A(0x48))],
  ['i64.atomic.rmw.cmpxchg', op(TokenType.AtomicRmwCmpxchg, A(0x49))],
  ['i32.atomic.rmw8.cmpxchg_u', op(TokenType.AtomicRmwCmpxchg, A(0x4a))],
  ['i32.atomic.rmw16.cmpxchg_u', op(TokenType.AtomicRmwCmpxchg, A(0x4b))],
  ['i64.atomic.rmw8.cmpxchg_u', op(TokenType.AtomicRmwCmpxchg, A(0x4c))],
  ['i64.atomic.rmw16.cmpxchg_u', op(TokenType.AtomicRmwCmpxchg, A(0x4d))],
  ['i64.atomic.rmw32.cmpxchg_u', op(TokenType.AtomicRmwCmpxchg, A(0x4e))],
]);

// ---------------------------------------------------------------------------
// Character class helpers
// ---------------------------------------------------------------------------

// Precomputed table matching C++ kCharClasses:
//   bit 8 = digit, bit 4 = hexdigit, bit 2 = keyword (a-z), bit 1 = idchar
const CHAR_CLASS = new Uint8Array(256);
(function buildCharClass() {
  for (let c = 0; c < 256; c++) {
    const ch = String.fromCharCode(c);
    const isDigit = c >= 48 && c <= 57;
    const isHex = isDigit || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
    const isKw = c >= 97 && c <= 122; // a-z
    // idchar: printable non-space excluding ()";,[]{} — exactly: !-~ minus those
    const isId = c >= 33 && c <= 126 &&
      ch !== '"' && ch !== '(' && ch !== ')' && ch !== ',' &&
      ch !== ';' && ch !== '[' && ch !== ']' && ch !== '{' && ch !== '}';
    CHAR_CLASS[c] = (isDigit ? 8 : 0) | (isHex ? 4 : 0) | (isKw ? 2 : 0) | (isId ? 1 : 0);
  }
})();

function isDigit(c: number): boolean {
  return (CHAR_CLASS[c] ?? 0) >= 8;
}
function isHexDigit(c: number): boolean {
  return ((CHAR_CLASS[c] ?? 0) & 4) !== 0;
}
function isKeyword(c: number): boolean {
  return ((CHAR_CLASS[c] ?? 0) & 2) !== 0;
}
function isIdChar(c: number): boolean {
  return ((CHAR_CLASS[c] ?? 0) & 1) !== 0;
}

const EOF = -1;

// ---------------------------------------------------------------------------
// WastLexer
// ---------------------------------------------------------------------------

export class WastLexer {
  private readonly src: LexerSource;
  private line = 1;
  private lineStart = 0;
  private tokenStart = 0;

  /** Accumulated errors during lexing. */
  readonly errors: WabtError[] = [];

  constructor(source: LexerSource | string) {
    this.src = source instanceof LexerSource ? source : new LexerSource(source);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Lex all tokens from the source, returning them in order (last is EOF). */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const tok = this.getToken();
      tokens.push(tok);
      if (tok.tokenType === TokenType.Eof) break;
    }
    return tokens;
  }

  // -------------------------------------------------------------------------
  // Core character helpers
  // -------------------------------------------------------------------------

  private peek(): number {
    return this.src.peek();
  }
  private read(): number {
    return this.src.read();
  }
  private get cursor(): number {
    return this.src.offset;
  }

  private matchChar(c: number): boolean {
    if (this.peek() === c) {
      this.read();
      return true;
    }
    return false;
  }

  private matchStr(s: string): boolean {
    const saved = this.cursor;
    for (let i = 0; i < s.length; i++) {
      if (this.read() !== s.charCodeAt(i)) {
        this.src.seek(saved);
        return false;
      }
    }
    return true;
  }

  private newlineChar(): void {
    this.line++;
    this.lineStart = this.cursor;
  }

  // -------------------------------------------------------------------------
  // Location helpers
  // -------------------------------------------------------------------------

  private getLocation(): Location {
    const col = (offset: number) => Math.max(1, offset - this.lineStart + 1);
    return {
      filename: this.src.filename,
      line: this.line,
      column: col(this.tokenStart),
      offset: this.tokenStart,
    };
  }

  private getText(skip = 0): string {
    return this.src.sliceText(this.tokenStart + skip, this.cursor);
  }

  // -------------------------------------------------------------------------
  // Token factories
  // -------------------------------------------------------------------------

  private bareToken(tt: TokenType): Token {
    return { loc: this.getLocation(), tokenType: tt };
  }

  private literalToken(tt: TokenType, literalType: LiteralType): Token {
    const literal: LiteralPayload = { literalType, text: this.getText() };
    return { loc: this.getLocation(), tokenType: tt, literal };
  }

  private textToken(tt: TokenType, skip = 0): Token {
    const text = this.getText(skip);
    return { loc: this.getLocation(), tokenType: tt, text };
  }

  private opcodeToken(tt: TokenType, o: number): Token {
    return {
      loc: this.getLocation(),
      tokenType: tt,
      opcode: o as unknown as typeof Opcode[keyof typeof Opcode],
    };
  }

  private typeToken(tt: TokenType, v: Type): Token {
    if (isRefKindToken(tt)) {
      return { loc: this.getLocation(), tokenType: tt, refType: v };
    }
    return { loc: this.getLocation(), tokenType: tt, valueType: v };
  }

  // -------------------------------------------------------------------------
  // Error reporting
  // -------------------------------------------------------------------------

  private error(msg: string): void {
    this.errors.push({ loc: this.getLocation(), message: msg, level: ErrorLevel.Error });
  }

  // -------------------------------------------------------------------------
  // Main tokenization loop
  // -------------------------------------------------------------------------

  getToken(): Token {
    while (true) {
      this.tokenStart = this.cursor;
      const c = this.peek();

      if (c === EOF) return this.bareToken(TokenType.Eof);

      switch (c) {
        case 0x28: // '('
          if (this.matchStr('(;')) {
            if (this.readBlockComment()) continue;
            return this.bareToken(TokenType.Eof);
          }
          if (this.matchStr('(@')) {
            this.getIdChars();
            return this.textToken(TokenType.LparAnn, 2);
          }
          this.read();
          return this.bareToken(TokenType.Lpar);

        case 0x29: // ')'
          this.read();
          return this.bareToken(TokenType.Rpar);

        case 0x3b: // ';'
          if (this.matchStr(';;')) {
            if (this.readLineComment()) continue;
            return this.bareToken(TokenType.Eof);
          }
          this.read();
          this.error('unexpected char');
          continue;

        case 0x20:
        case 0x09:
        case 0x0d:
        case 0x0a: // space, tab, CR, LF
          this.readWhitespace();
          continue;

        case 0x22: // '"'
          return this.getStringToken(TokenType.Text);

        case 0x2b:
        case 0x2d: // '+', '-'
          this.read();
          switch (this.peek()) {
            case 0x69: { // 'i' → inf
              const tok = this.getInfToken();
              if (tok !== null) return tok;
              return this.getReservedToken();
            }
            case 0x6e: { // 'n' → nan
              const tok = this.getNanToken();
              if (tok !== null) return tok;
              return this.getReservedToken();
            }
            case 0x30: // '0'
              return this.matchStr('0x')
                ? this.getHexNumberToken(TokenType.Int)
                : this.getNumberToken(TokenType.Int);
            default:
              if (isDigit(this.peek())) return this.getNumberToken(TokenType.Int);
              return this.getReservedToken();
          }

        case 0x30: // '0'
          return this.matchStr('0x')
            ? this.getHexNumberToken(TokenType.Nat)
            : this.getNumberToken(TokenType.Nat);

        case 0x31:
        case 0x32:
        case 0x33:
        case 0x34:
        case 0x35:
        case 0x36:
        case 0x37:
        case 0x38:
        case 0x39: // '1'-'9'
          return this.getNumberToken(TokenType.Nat);

        case 0x24: { // '$'
          this.read();
          if (this.peek() === 0x22) return this.getStringToken(TokenType.Var);
          return this.getIdChars();
        }

        case 0x61: // 'a' — maybe "align="
          return this.getNameEqNumToken('align=', TokenType.AlignEqNat);

        case 0x69: // 'i' — maybe "inf"
          return this.getInfToken() ?? this.getKeywordToken();

        case 0x6e: // 'n' — maybe "nan"
          return this.getNanToken() ?? this.getKeywordToken();

        case 0x6f: // 'o' — maybe "offset="
          return this.getNameEqNumToken('offset=', TokenType.OffsetEqNat);

        default:
          if (isKeyword(c)) return this.getKeywordToken();
          if (isIdChar(c)) return this.getReservedToken();
          this.read();
          this.error('unexpected char');
          continue;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Comment readers
  // -------------------------------------------------------------------------

  private readBlockComment(): boolean {
    let nesting = 1;
    while (true) {
      const c = this.read();
      if (c === EOF) {
        this.error('EOF in block comment');
        return false;
      }
      if (c === 0x3b && this.matchChar(0x29)) { if (--nesting === 0) return true; }
      else if (c === 0x28 && this.matchChar(0x3b)) nesting++;
      else if (c === 0x0a) this.newlineChar();
    }
  }

  private readLineComment(): boolean {
    while (true) {
      const c = this.read();
      if (c === EOF) return false;
      if (c === 0x0d) {
        this.matchChar(0x0a);
        this.newlineChar();
        return true;
      }
      if (c === 0x0a) {
        this.newlineChar();
        return true;
      }
    }
  }

  private readWhitespace(): void {
    while (true) {
      const c = this.peek();
      if (c === 0x20 || c === 0x09 || c === 0x0d) {
        this.read();
        continue;
      }
      if (c === 0x0a) {
        this.read();
        this.newlineChar();
        continue;
      }
      break;
    }
  }

  // -------------------------------------------------------------------------
  // String token
  // -------------------------------------------------------------------------

  private getStringToken(tt: TokenType): Token {
    const savedStart = this.tokenStart;
    let hasError = false;
    this.read(); // consume opening '"'
    outer: while (true) {
      const c = this.read();
      if (c === EOF) return this.bareToken(TokenType.Eof);
      if (c === 0x0a) {
        this.tokenStart = this.cursor - 1;
        this.error('newline in string');
        hasError = true;
        this.newlineChar();
        continue;
      }
      if (c === 0x22) { // closing '"'
        if (this.peek() === 0x22) {
          this.error('invalid string token');
          hasError = true;
        }
        break;
      }
      if (c === 0x5c) { // backslash escape
        const e = this.read();
        switch (e) {
          case 0x74:
          case 0x6e:
          case 0x72:
          case 0x22:
          case 0x27:
          case 0x5c:
            break; // valid single-char escapes
          case 0x30:
          case 0x31:
          case 0x32:
          case 0x33:
          case 0x34:
          case 0x35:
          case 0x36:
          case 0x37:
          case 0x38:
          case 0x39:
          case 0x61:
          case 0x62:
          case 0x63:
          case 0x64:
          case 0x65:
          case 0x66:
          case 0x41:
          case 0x42:
          case 0x43:
          case 0x44:
          case 0x45:
          case 0x46:
            if (isHexDigit(this.peek())) {
              this.read();
              break;
            }
            this.tokenStart = this.cursor - 2;
            this.error(`bad escape`);
            hasError = true;
            break;
          case 0x75: { // \u{XXXX}
            this.tokenStart = this.cursor - 2;
            if (!this.matchChar(0x7b)) {
              this.error('bad escape');
              hasError = true;
              break;
            }
            let scalar = 0;
            while (isHexDigit(this.peek())) {
              const digit = parseInt(String.fromCharCode(this.read()), 16);
              scalar = (scalar << 4) | digit;
              if (scalar >= 0x110000) {
                this.error('bad escape');
                hasError = true;
                break outer;
              }
            }
            if (!this.matchChar(0x7d)) {
              this.error('bad escape');
              hasError = true;
              break;
            }
            if ((scalar >= 0xd800 && scalar < 0xe000)) {
              this.error('bad escape');
              hasError = true;
            }
            break;
          }
          default:
            this.tokenStart = this.cursor - 2;
            this.error(`bad escape`);
            hasError = true;
        }
      }
    }
    this.tokenStart = savedStart;
    if (hasError) return { loc: this.getLocation(), tokenType: TokenType.Invalid };
    return this.textToken(tt);
  }

  // -------------------------------------------------------------------------
  // Numeric token helpers
  // -------------------------------------------------------------------------

  private readSign(): void {
    const c = this.peek();
    if (c === 0x2b || c === 0x2d) this.read();
  }

  private readNum(): boolean {
    if (!isDigit(this.peek())) return false;
    this.read();
    while (true) {
      if (this.matchChar(0x5f)) continue; // '_' separator
      if (!isDigit(this.peek())) break;
      this.read();
    }
    return true;
  }

  private readHexNum(): boolean {
    if (!isHexDigit(this.peek())) return false;
    this.read();
    while (true) {
      if (this.matchChar(0x5f)) continue;
      if (!isHexDigit(this.peek())) break;
      this.read();
    }
    return true;
  }

  private noTrailingReserved(): boolean {
    return !isIdChar(this.peek());
  }

  private getNumberToken(tt: TokenType): Token {
    if (this.readNum()) {
      if (this.matchChar(0x2e)) { // '.'
        tt = TokenType.Float;
        if (isDigit(this.peek()) && !this.readNum()) return this.getReservedToken();
      }
      if (this.matchChar(0x65) || this.matchChar(0x45)) { // 'e' or 'E'
        tt = TokenType.Float;
        this.readSign();
        if (!this.readNum()) return this.getReservedToken();
      }
      if (this.noTrailingReserved()) {
        return this.literalToken(tt, tt === TokenType.Float ? LiteralType.Float : LiteralType.Int);
      }
    }
    return this.getReservedToken();
  }

  private getHexNumberToken(tt: TokenType): Token {
    if (this.readHexNum()) {
      if (this.matchChar(0x2e)) { // '.'
        tt = TokenType.Float;
        if (isHexDigit(this.peek()) && !this.readHexNum()) return this.getReservedToken();
      }
      if (this.matchChar(0x70) || this.matchChar(0x50)) { // 'p' or 'P'
        tt = TokenType.Float;
        this.readSign();
        if (!this.readNum()) return this.getReservedToken();
      }
      if (this.noTrailingReserved()) {
        return this.literalToken(
          tt,
          tt === TokenType.Float ? LiteralType.Hexfloat : LiteralType.Int,
        );
      }
    }
    return this.getReservedToken();
  }

  private getInfToken(): Token | null {
    if (this.matchStr('inf')) {
      if (this.noTrailingReserved()) {
        return this.literalToken(TokenType.Float, LiteralType.Infinity);
      }
      return this.getReservedToken();
    }
    return null;
  }

  private getNanToken(): Token | null {
    if (this.matchStr('nan')) {
      if (this.matchChar(0x3a)) { // ':'
        if (this.matchStr('0x') && this.readHexNum() && this.noTrailingReserved()) {
          return this.literalToken(TokenType.Float, LiteralType.Nan);
        }
        // reset — will fall through to keyword
        return null;
      }
      if (this.noTrailingReserved()) {
        return this.literalToken(TokenType.Float, LiteralType.Nan);
      }
      return this.getReservedToken();
    }
    return null;
  }

  private getNameEqNumToken(name: string, tt: TokenType): Token {
    if (this.matchStr(name)) {
      if (this.matchStr('0x')) {
        if (this.readHexNum() && this.noTrailingReserved()) {
          return this.textToken(tt, name.length);
        }
      } else if (this.readNum() && this.noTrailingReserved()) {
        return this.textToken(tt, name.length);
      }
    }
    return this.getKeywordToken();
  }

  // -------------------------------------------------------------------------
  // Id / keyword readers
  // -------------------------------------------------------------------------

  private getIdChars(): Token {
    // Read all id chars (and embedded strings); if no embedded strings → Var
    let hasString = false;
    while (true) {
      if (isIdChar(this.peek())) {
        this.read();
        continue;
      }
      if (this.peek() === 0x22) {
        this.getStringToken(TokenType.Text);
        hasString = true;
        continue;
      }
      break;
    }
    return hasString ? this.textToken(TokenType.Reserved) : this.textToken(TokenType.Var);
  }

  private getKeywordToken(): Token {
    // Read all reserved chars
    while (isIdChar(this.peek())) this.read();
    const word = this.getText();
    const info = KEYWORDS.get(word);
    if (!info) return this.textToken(TokenType.Reserved);
    if ('vt' in info) return this.typeToken(info.tt, info.vt);
    if ('op' in info) return this.opcodeToken(info.tt, info.op);
    return this.bareToken(info.tt);
  }

  private getReservedToken(): Token {
    while (isIdChar(this.peek())) this.read();
    return this.textToken(TokenType.Reserved);
  }
}
