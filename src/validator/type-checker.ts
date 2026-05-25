// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/type-checker.cc / include/wabt/type-checker.h
// Copyright 2017 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

import { combineResults, Result } from '../core/result.ts';
import { Type, typeName } from '../core/types.ts';
import type { Index } from '../core/types.ts';
import { MiscOpcode, Opcode } from '../core/opcode.ts';
import { LabelType } from '../ir/ir-util.ts';

// ---------------------------------------------------------------------------
// FuncType — shared with SharedValidator
// ---------------------------------------------------------------------------

export interface FuncType {
  params: Type[];
  results: Type[];
  typeIndex: Index;
}

// ---------------------------------------------------------------------------
// Opcode type info — {p1, p2, p3, r1, natAlign}
// Type.Void means "no param / no result".
// natAlign is the natural byte alignment for memory ops (0 = N/A).
// ---------------------------------------------------------------------------

interface OpcodeTypeInfo {
  p1: Type;
  p2: Type;
  p3: Type;
  r1: Type;
  natAlign: number;
}

const _V = Type.Void;
const _I32 = Type.I32;
const _I64 = Type.I64;
const _F32 = Type.F32;
const _F64 = Type.F64;
const _V128 = Type.V128;

function oi(r1: Type, p1: Type, p2: Type, p3: Type, nat: number): OpcodeTypeInfo {
  return { r1, p1, p2, p3, natAlign: nat };
}

function getOpcodeTypeInfo(opcode: number): OpcodeTypeInfo {
  switch (opcode) {
    // --- Loads ---
    case Opcode.I32Load:
      return oi(_I32, _I32, _V, _V, 4);
    case Opcode.I64Load:
      return oi(_I64, _I32, _V, _V, 8);
    case Opcode.F32Load:
      return oi(_F32, _I32, _V, _V, 4);
    case Opcode.F64Load:
      return oi(_F64, _I32, _V, _V, 8);
    case Opcode.I32Load8S:
      return oi(_I32, _I32, _V, _V, 1);
    case Opcode.I32Load8U:
      return oi(_I32, _I32, _V, _V, 1);
    case Opcode.I32Load16S:
      return oi(_I32, _I32, _V, _V, 2);
    case Opcode.I32Load16U:
      return oi(_I32, _I32, _V, _V, 2);
    case Opcode.I64Load8S:
      return oi(_I64, _I32, _V, _V, 1);
    case Opcode.I64Load8U:
      return oi(_I64, _I32, _V, _V, 1);
    case Opcode.I64Load16S:
      return oi(_I64, _I32, _V, _V, 2);
    case Opcode.I64Load16U:
      return oi(_I64, _I32, _V, _V, 2);
    case Opcode.I64Load32S:
      return oi(_I64, _I32, _V, _V, 4);
    case Opcode.I64Load32U:
      return oi(_I64, _I32, _V, _V, 4);
    // --- Stores ---
    case Opcode.I32Store:
      return oi(_V, _I32, _I32, _V, 4);
    case Opcode.I64Store:
      return oi(_V, _I32, _I64, _V, 8);
    case Opcode.F32Store:
      return oi(_V, _I32, _F32, _V, 4);
    case Opcode.F64Store:
      return oi(_V, _I32, _F64, _V, 8);
    case Opcode.I32Store8:
      return oi(_V, _I32, _I32, _V, 1);
    case Opcode.I32Store16:
      return oi(_V, _I32, _I32, _V, 2);
    case Opcode.I64Store8:
      return oi(_V, _I32, _I64, _V, 1);
    case Opcode.I64Store16:
      return oi(_V, _I32, _I64, _V, 2);
    case Opcode.I64Store32:
      return oi(_V, _I32, _I64, _V, 4);
    // --- i32 comparisons ---
    case Opcode.I32Eqz:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I32Eq:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Ne:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32LtS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32LtU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32GtS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32GtU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32LeS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32LeU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32GeS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32GeU:
      return oi(_I32, _I32, _I32, _V, 0);
    // --- i64 comparisons ---
    case Opcode.I64Eqz:
      return oi(_I32, _I64, _V, _V, 0);
    case Opcode.I64Eq:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64Ne:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64LtS:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64LtU:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64GtS:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64GtU:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64LeS:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64LeU:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64GeS:
      return oi(_I32, _I64, _I64, _V, 0);
    case Opcode.I64GeU:
      return oi(_I32, _I64, _I64, _V, 0);
    // --- f32 comparisons ---
    case Opcode.F32Eq:
      return oi(_I32, _F32, _F32, _V, 0);
    case Opcode.F32Ne:
      return oi(_I32, _F32, _F32, _V, 0);
    case Opcode.F32Lt:
      return oi(_I32, _F32, _F32, _V, 0);
    case Opcode.F32Gt:
      return oi(_I32, _F32, _F32, _V, 0);
    case Opcode.F32Le:
      return oi(_I32, _F32, _F32, _V, 0);
    case Opcode.F32Ge:
      return oi(_I32, _F32, _F32, _V, 0);
    // --- f64 comparisons ---
    case Opcode.F64Eq:
      return oi(_I32, _F64, _F64, _V, 0);
    case Opcode.F64Ne:
      return oi(_I32, _F64, _F64, _V, 0);
    case Opcode.F64Lt:
      return oi(_I32, _F64, _F64, _V, 0);
    case Opcode.F64Gt:
      return oi(_I32, _F64, _F64, _V, 0);
    case Opcode.F64Le:
      return oi(_I32, _F64, _F64, _V, 0);
    case Opcode.F64Ge:
      return oi(_I32, _F64, _F64, _V, 0);
    // --- i32 arithmetic ---
    case Opcode.I32Clz:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I32Ctz:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I32Popcnt:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I32Add:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Sub:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Mul:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32DivS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32DivU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32RemS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32RemU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32And:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Or:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Xor:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Shl:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32ShrS:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32ShrU:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Rotl:
      return oi(_I32, _I32, _I32, _V, 0);
    case Opcode.I32Rotr:
      return oi(_I32, _I32, _I32, _V, 0);
    // --- i64 arithmetic ---
    case Opcode.I64Clz:
      return oi(_I64, _I64, _V, _V, 0);
    case Opcode.I64Ctz:
      return oi(_I64, _I64, _V, _V, 0);
    case Opcode.I64Popcnt:
      return oi(_I64, _I64, _V, _V, 0);
    case Opcode.I64Add:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Sub:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Mul:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64DivS:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64DivU:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64RemS:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64RemU:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64And:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Or:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Xor:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Shl:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64ShrS:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64ShrU:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Rotl:
      return oi(_I64, _I64, _I64, _V, 0);
    case Opcode.I64Rotr:
      return oi(_I64, _I64, _I64, _V, 0);
    // --- f32 arithmetic ---
    case Opcode.F32Abs:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Neg:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Ceil:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Floor:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Trunc:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Nearest:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Sqrt:
      return oi(_F32, _F32, _V, _V, 0);
    case Opcode.F32Add:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Sub:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Mul:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Div:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Min:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Max:
      return oi(_F32, _F32, _F32, _V, 0);
    case Opcode.F32Copysign:
      return oi(_F32, _F32, _F32, _V, 0);
    // --- f64 arithmetic ---
    case Opcode.F64Abs:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Neg:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Ceil:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Floor:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Trunc:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Nearest:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Sqrt:
      return oi(_F64, _F64, _V, _V, 0);
    case Opcode.F64Add:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Sub:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Mul:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Div:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Min:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Max:
      return oi(_F64, _F64, _F64, _V, 0);
    case Opcode.F64Copysign:
      return oi(_F64, _F64, _F64, _V, 0);
    // --- conversions ---
    case Opcode.I32WrapI64:
      return oi(_I32, _I64, _V, _V, 0);
    case Opcode.I32TruncF32S:
      return oi(_I32, _F32, _V, _V, 0);
    case Opcode.I32TruncF32U:
      return oi(_I32, _F32, _V, _V, 0);
    case Opcode.I32TruncF64S:
      return oi(_I32, _F64, _V, _V, 0);
    case Opcode.I32TruncF64U:
      return oi(_I32, _F64, _V, _V, 0);
    case Opcode.I64ExtendI32S:
      return oi(_I64, _I32, _V, _V, 0);
    case Opcode.I64ExtendI32U:
      return oi(_I64, _I32, _V, _V, 0);
    case Opcode.I64TruncF32S:
      return oi(_I64, _F32, _V, _V, 0);
    case Opcode.I64TruncF32U:
      return oi(_I64, _F32, _V, _V, 0);
    case Opcode.I64TruncF64S:
      return oi(_I64, _F64, _V, _V, 0);
    case Opcode.I64TruncF64U:
      return oi(_I64, _F64, _V, _V, 0);
    case Opcode.F32ConvertI32S:
      return oi(_F32, _I32, _V, _V, 0);
    case Opcode.F32ConvertI32U:
      return oi(_F32, _I32, _V, _V, 0);
    case Opcode.F32ConvertI64S:
      return oi(_F32, _I64, _V, _V, 0);
    case Opcode.F32ConvertI64U:
      return oi(_F32, _I64, _V, _V, 0);
    case Opcode.F32DemoteF64:
      return oi(_F32, _F64, _V, _V, 0);
    case Opcode.F64ConvertI32S:
      return oi(_F64, _I32, _V, _V, 0);
    case Opcode.F64ConvertI32U:
      return oi(_F64, _I32, _V, _V, 0);
    case Opcode.F64ConvertI64S:
      return oi(_F64, _I64, _V, _V, 0);
    case Opcode.F64ConvertI64U:
      return oi(_F64, _I64, _V, _V, 0);
    case Opcode.F64PromoteF32:
      return oi(_F64, _F32, _V, _V, 0);
    case Opcode.I32ReinterpretF32:
      return oi(_I32, _F32, _V, _V, 0);
    case Opcode.I64ReinterpretF64:
      return oi(_I64, _F64, _V, _V, 0);
    case Opcode.F32ReinterpretI32:
      return oi(_F32, _I32, _V, _V, 0);
    case Opcode.F64ReinterpretI64:
      return oi(_F64, _I64, _V, _V, 0);
    // --- sign-extension ---
    case Opcode.I32Extend8S:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I32Extend16S:
      return oi(_I32, _I32, _V, _V, 0);
    case Opcode.I64Extend8S:
      return oi(_I64, _I64, _V, _V, 0);
    case Opcode.I64Extend16S:
      return oi(_I64, _I64, _V, _V, 0);
    case Opcode.I64Extend32S:
      return oi(_I64, _I64, _V, _V, 0);
    // Default: SIMD / unknown — V128 binary pattern
    default:
      return oi(_V128, _V128, _V128, _V, 0);
  }
}

/** Returns the natural byte alignment for a load/store opcode (0 = N/A). */
export function getOpcodeNaturalAlign(opcode: number): number {
  return getOpcodeTypeInfo(opcode).natAlign;
}

// For MiscOpcode sat-trunc (passed via ConvertExpr.opcode when opcode < 8)
export function getMiscOpcodeTypeInfo(misc: number): OpcodeTypeInfo {
  switch (misc) {
    case MiscOpcode.I32TruncSatF32S:
      return oi(_I32, _F32, _V, _V, 0);
    case MiscOpcode.I32TruncSatF32U:
      return oi(_I32, _F32, _V, _V, 0);
    case MiscOpcode.I32TruncSatF64S:
      return oi(_I32, _F64, _V, _V, 0);
    case MiscOpcode.I32TruncSatF64U:
      return oi(_I32, _F64, _V, _V, 0);
    case MiscOpcode.I64TruncSatF32S:
      return oi(_I64, _F32, _V, _V, 0);
    case MiscOpcode.I64TruncSatF32U:
      return oi(_I64, _F32, _V, _V, 0);
    case MiscOpcode.I64TruncSatF64S:
      return oi(_I64, _F64, _V, _V, 0);
    case MiscOpcode.I64TruncSatF64U:
      return oi(_I64, _F64, _V, _V, 0);
    default:
      return oi(_V128, _V128, _V128, _V, 0);
  }
}

// Apply memory64 flag: replace I32 address param with I64
function applyMemory64(info: OpcodeTypeInfo, is64: boolean): OpcodeTypeInfo {
  if (!is64) return info;
  return {
    r1: info.r1,
    p1: info.p1 === _I32 ? _I64 : info.p1,
    p2: info.p2,
    p3: info.p3,
    natAlign: info.natAlign,
  };
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

interface TCLabel {
  labelType: LabelType;
  paramTypes: Type[];
  resultTypes: Type[];
  typeStackLimit: number;
  unreachable: boolean;
}

function brTypes(label: TCLabel): Type[] {
  return label.labelType === LabelType.Loop ? label.paramTypes : label.resultTypes;
}

// ---------------------------------------------------------------------------
// TypeChecker
// ---------------------------------------------------------------------------

export class TypeChecker {
  private typeStack: Type[] = [];
  private labelStack: TCLabel[] = [];
  private brTableSig: Type[] | null = null;
  private errorCallback: (msg: string) => void = () => {};
  readonly funcTypes: Map<number, FuncType>;

  constructor(funcTypes: Map<number, FuncType>) {
    this.funcTypes = funcTypes;
  }

  setErrorCallback(cb: (msg: string) => void): void {
    this.errorCallback = cb;
  }

  typeStackSize(): number {
    return this.typeStack.length;
  }

  isUnreachable(): boolean {
    const label = this.topLabel();
    return label === null ? true : label.unreachable;
  }

  // ---------------------------------------------------------------------------
  // Label management
  // ---------------------------------------------------------------------------

  getLabel(depth: number): TCLabel | null {
    if (this.labelStack.length === 0) {
      this.printError(`invalid depth: ${depth} (no labels)`);
      return null;
    }
    const idx = this.labelStack.length - depth - 1;
    if (idx < 0) {
      this.printError(`invalid depth: ${depth} (max ${this.labelStack.length - 1})`);
      return null;
    }
    return this.labelStack[idx] ?? null;
  }

  private topLabel(): TCLabel | null {
    return this.getLabel(0);
  }

  private pushLabel(labelType: LabelType, paramTypes: Type[], resultTypes: Type[]): void {
    this.labelStack.push({
      labelType,
      paramTypes: [...paramTypes],
      resultTypes: [...resultTypes],
      typeStackLimit: this.typeStack.length,
      unreachable: false,
    });
  }

  private popLabel(): Result {
    this.labelStack.pop();
    return Result.Ok;
  }

  private resetTypeStackToLabel(label: TCLabel): void {
    this.typeStack.length = label.typeStackLimit;
  }

  private setUnreachable(): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    label.unreachable = true;
    this.resetTypeStackToLabel(label);
    return Result.Ok;
  }

  // ---------------------------------------------------------------------------
  // Type stack operations
  // ---------------------------------------------------------------------------

  private peekType(depth: number): Type {
    const label = this.topLabel();
    if (!label) return Type.Any;
    const limit = label.typeStackLimit;
    if (limit + depth >= this.typeStack.length) {
      return Type.Any;
    }
    return this.typeStack[this.typeStack.length - depth - 1] ?? Type.Any;
  }

  private dropTypes(count: number): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    if (label.typeStackLimit + count > this.typeStack.length) {
      this.resetTypeStackToLabel(label);
      return label.unreachable ? Result.Ok : Result.Error;
    }
    this.typeStack.length -= count;
    return Result.Ok;
  }

  private pushType(type: Type): void {
    if (type !== Type.Void) {
      this.typeStack.push(type);
    }
  }

  private pushTypes(types: Type[]): void {
    for (const t of types) this.pushType(t);
  }

  // ---------------------------------------------------------------------------
  // Type checking helpers
  // ---------------------------------------------------------------------------

  checkType(actual: Type, expected: Type): Result {
    if (expected === Type.Any || actual === Type.Any) return Result.Ok;
    if (actual === expected) return Result.Ok;
    if (
      expected === Type.FuncRef &&
      (actual === Type.Ref || actual === Type.RefNull)
    ) return Result.Ok;
    if (
      expected === Type.ExternRef &&
      (actual === Type.Ref || actual === Type.RefNull)
    ) return Result.Ok;
    return Result.Error;
  }

  private popAndCheck1Type(expected: Type, desc: string): Result {
    const actual = this.peekType(0);
    const r = this.checkType(actual, expected);
    if (r === Result.Error) {
      this.printError(
        `type mismatch in ${desc}, expected [${typeName(expected)}] but got [${typeName(actual)}]`,
      );
    }
    return combineResults(r, this.dropTypes(1));
  }

  private popAndCheck2Types(exp1: Type, exp2: Type, desc: string): Result {
    const a2 = this.peekType(0);
    const a1 = this.peekType(1);
    let r = this.checkType(a1, exp1);
    r = combineResults(r, this.checkType(a2, exp2));
    if (r === Result.Error) {
      this.printError(
        `type mismatch in ${desc}, expected [${typeName(exp1)}, ${typeName(exp2)}] but got [${
          typeName(a1)
        }, ${typeName(a2)}]`,
      );
    }
    return combineResults(r, this.dropTypes(2));
  }

  private popAndCheck3Types(exp1: Type, exp2: Type, exp3: Type, desc: string): Result {
    const a3 = this.peekType(0);
    const a2 = this.peekType(1);
    const a1 = this.peekType(2);
    let r = this.checkType(a1, exp1);
    r = combineResults(r, this.checkType(a2, exp2));
    r = combineResults(r, this.checkType(a3, exp3));
    if (r === Result.Error) {
      this.printError(
        `type mismatch in ${desc}, expected [${typeName(exp1)}, ${typeName(exp2)}, ${
          typeName(exp3)
        }] but got [${typeName(a1)}, ${typeName(a2)}, ${typeName(a3)}]`,
      );
    }
    return combineResults(r, this.dropTypes(3));
  }

  private checkSignature(sig: Type[], desc: string): Result {
    let r = Result.Ok;
    for (let i = 0; i < sig.length; i++) {
      const expected = sig[i] ?? Type.Any;
      const actual = this.peekType(sig.length - i - 1);
      r = combineResults(r, this.checkType(actual, expected));
    }
    if (r === Result.Error) {
      this.printError(`type mismatch in ${desc}`);
    }
    return r;
  }

  private popAndCheckSignature(sig: Type[], desc: string): Result {
    const r = this.checkSignature(sig, desc);
    return combineResults(r, this.dropTypes(sig.length));
  }

  private popAndCheckCall(paramTypes: Type[], resultTypes: Type[], desc: string): Result {
    const r = this.popAndCheckSignature(paramTypes, desc);
    this.pushTypes(resultTypes);
    return r;
  }

  private popAndCheckReturnCall(resultTypes: Type[], desc: string): Result {
    const r = this.checkSignature(resultTypes, desc);
    return combineResults(r, this.setUnreachable());
  }

  private checkTypeStackEnd(desc: string): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    if (this.typeStack.length !== label.typeStackLimit) {
      this.printError(`type mismatch at end of ${desc}`);
      return Result.Error;
    }
    return Result.Ok;
  }

  private getFuncLabel(): TCLabel | null {
    return this.getLabel(this.labelStack.length - 1);
  }

  private printError(msg: string): void {
    this.errorCallback(msg);
  }

  // ---------------------------------------------------------------------------
  // Opcode dispatch helpers
  // ---------------------------------------------------------------------------

  private checkOpcode1(opcode: number, is64Memory = false): Result {
    const info = applyMemory64(getOpcodeTypeInfo(opcode), is64Memory);
    const r = this.popAndCheck1Type(info.p1, `opcode`);
    this.pushType(info.r1);
    return r;
  }

  private checkOpcode2(opcode: number, is64Memory = false): Result {
    const info = applyMemory64(getOpcodeTypeInfo(opcode), is64Memory);
    const r = this.popAndCheck2Types(info.p1, info.p2, `opcode`);
    this.pushType(info.r1);
    return r;
  }

  private checkOpcode3(opcode: number, is64Memory = false): Result {
    const info = applyMemory64(getOpcodeTypeInfo(opcode), is64Memory);
    const r = this.popAndCheck3Types(info.p1, info.p2, info.p3, `opcode`);
    this.pushType(info.r1);
    return r;
  }

  // ---------------------------------------------------------------------------
  // Function scope
  // ---------------------------------------------------------------------------

  beginFunction(params: Type[], results: Type[]): Result {
    this.typeStack = [];
    this.labelStack = [];
    this.pushLabel(LabelType.Func, params, results);
    return Result.Ok;
  }

  endFunction(): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    let r = this.popAndCheckSignature(label.resultTypes, 'function');
    r = combineResults(r, this.checkTypeStackEnd('function'));
    r = combineResults(r, this.popLabel());
    return r;
  }

  beginInitExpr(type: Type): Result {
    this.typeStack = [];
    this.labelStack = [];
    this.pushLabel(LabelType.Func, [], [type]);
    return Result.Ok;
  }

  endInitExpr(): Result {
    return this.endFunction();
  }

  // ---------------------------------------------------------------------------
  // Instruction handlers
  // ---------------------------------------------------------------------------

  onConst(type: Type): Result {
    this.pushType(type);
    return Result.Ok;
  }

  onBinary(opcode: number): Result {
    return this.checkOpcode2(opcode);
  }
  onUnary(opcode: number): Result {
    return this.checkOpcode1(opcode);
  }
  onCompare(opcode: number): Result {
    return this.checkOpcode2(opcode);
  }
  onConvert(opcode: number): Result {
    return this.checkOpcode1(opcode);
  }

  onTernary(_opcode: number): Result {
    const r = this.popAndCheck3Types(_V128, _V128, _V128, `ternary`);
    this.pushType(_V128);
    return r;
  }

  onQuaternary(_opcode: number): Result {
    // 4 V128 params → V128 result; pop extra 1 after 3-check
    let r = this.popAndCheck3Types(_V128, _V128, _V128, `quaternary`);
    r = combineResults(r, this.dropTypes(1));
    this.pushType(_V128);
    return r;
  }

  onLoad(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode1(opcode, is64Memory);
  }

  onStore(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode2(opcode, is64Memory);
  }

  onLoadSplat(_opcode: number, is64Memory: boolean): Result {
    const addrType = is64Memory ? _I64 : _I32;
    const r = this.popAndCheck1Type(addrType, `load_splat`);
    this.pushType(_V128);
    return r;
  }

  onLoadZero(_opcode: number, is64Memory: boolean): Result {
    const addrType = is64Memory ? _I64 : _I32;
    const r = this.popAndCheck1Type(addrType, `load_zero`);
    this.pushType(_V128);
    return r;
  }

  onAtomicFence(): Result {
    return Result.Ok;
  }

  onAtomicLoad(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode1(opcode, is64Memory);
  }

  onAtomicStore(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode2(opcode, is64Memory);
  }

  onAtomicRmw(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode2(opcode, is64Memory);
  }

  onAtomicRmwCmpxchg(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode3(opcode, is64Memory);
  }

  onAtomicWait(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode3(opcode, is64Memory);
  }

  onAtomicNotify(opcode: number, is64Memory: boolean): Result {
    return this.checkOpcode2(opcode, is64Memory);
  }

  // ---------------------------------------------------------------------------
  // Control flow
  // ---------------------------------------------------------------------------

  onBlock(paramTypes: Type[], resultTypes: Type[]): Result {
    const r = this.popAndCheckSignature(paramTypes, 'block');
    this.pushLabel(LabelType.Block, paramTypes, resultTypes);
    this.pushTypes(paramTypes);
    return r;
  }

  onLoop(paramTypes: Type[], resultTypes: Type[]): Result {
    const r = this.popAndCheckSignature(paramTypes, 'loop');
    this.pushLabel(LabelType.Loop, paramTypes, resultTypes);
    this.pushTypes(paramTypes);
    return r;
  }

  onIf(paramTypes: Type[], resultTypes: Type[]): Result {
    let r = this.popAndCheck1Type(_I32, 'if');
    r = combineResults(r, this.popAndCheckSignature(paramTypes, 'if'));
    this.pushLabel(LabelType.If, paramTypes, resultTypes);
    this.pushTypes(paramTypes);
    return r;
  }

  onElse(): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    let r = Result.Ok;
    if (label.labelType !== LabelType.If) {
      this.printError('else outside of if block');
      r = Result.Error;
    } else {
      r = combineResults(r, this.popAndCheckSignature(label.resultTypes, 'if block'));
      r = combineResults(r, this.checkTypeStackEnd('if block'));
      this.resetTypeStackToLabel(label);
      label.labelType = LabelType.Else;
      label.unreachable = false;
      this.pushTypes(label.paramTypes);
    }
    return r;
  }

  onEnd(): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    let r = this.popAndCheckSignature(label.resultTypes, 'end');
    r = combineResults(r, this.checkTypeStackEnd('end'));
    this.resetTypeStackToLabel(label);
    this.pushTypes(label.resultTypes);
    r = combineResults(r, this.popLabel());
    return r;
  }

  onBr(depth: number): Result {
    const label = this.getLabel(depth);
    if (!label) return Result.Error;
    const r = this.checkSignature(brTypes(label), 'br');
    return combineResults(r, this.setUnreachable());
  }

  onBrIf(depth: number): Result {
    let r = this.popAndCheck1Type(_I32, 'br_if');
    const label = this.getLabel(depth);
    if (!label) return combineResults(r, Result.Error);
    r = combineResults(r, this.popAndCheckSignature(brTypes(label), 'br_if'));
    this.pushTypes(brTypes(label));
    return r;
  }

  beginBrTable(): Result {
    this.brTableSig = null;
    return this.popAndCheck1Type(_I32, 'br_table');
  }

  onBrTableTarget(depth: number): Result {
    const label = this.getLabel(depth);
    if (!label) return Result.Error;
    const sig = brTypes(label);
    const r = this.checkSignature(sig, 'br_table');
    if (this.brTableSig === null) {
      this.brTableSig = sig;
    } else if (this.brTableSig.length !== sig.length) {
      this.printError('br_table labels have inconsistent types');
      return Result.Error;
    }
    return r;
  }

  endBrTable(): Result {
    return this.setUnreachable();
  }

  onBrOnNull(depth: number): Result {
    const actual = this.peekType(0);
    let r = this.dropTypes(1);
    const label = this.getLabel(depth);
    if (!label) return combineResults(r, Result.Error);
    r = combineResults(r, this.popAndCheckSignature(brTypes(label), 'br_on_null'));
    this.pushTypes(brTypes(label));
    if (actual !== Type.Any) this.pushType(actual);
    return r;
  }

  onBrOnNonNull(depth: number): Result {
    const actual = this.peekType(0);
    let r = this.dropTypes(1);
    if (actual !== Type.Any) this.pushType(actual);
    const label = this.getLabel(depth);
    if (!label) return combineResults(r, Result.Error);
    r = combineResults(r, this.popAndCheckSignature(brTypes(label), 'br_on_non_null'));
    this.pushTypes(brTypes(label));
    if (actual !== Type.Any) r = combineResults(r, this.dropTypes(1));
    return r;
  }

  onCall(paramTypes: Type[], resultTypes: Type[]): Result {
    return this.popAndCheckCall(paramTypes, resultTypes, 'call');
  }

  onCallIndirect(paramTypes: Type[], resultTypes: Type[], is64Table: boolean): Result {
    const addrType = is64Table ? _I64 : _I32;
    let r = this.popAndCheck1Type(addrType, 'call_indirect');
    r = combineResults(r, this.popAndCheckCall(paramTypes, resultTypes, 'call_indirect'));
    return r;
  }

  onCallRef(refType: Type, paramTypes: Type[], resultTypes: Type[]): Result {
    let r = this.popAndCheck1Type(refType, 'call_ref');
    r = combineResults(r, this.popAndCheckCall(paramTypes, resultTypes, 'call_ref'));
    return r;
  }

  onReturnCall(paramTypes: Type[], resultTypes: Type[]): Result {
    let r = this.popAndCheckSignature(paramTypes, 'return_call');
    r = combineResults(r, this.popAndCheckReturnCall(resultTypes, 'return_call'));
    return r;
  }

  onReturnCallIndirect(paramTypes: Type[], resultTypes: Type[], is64Table: boolean): Result {
    const addrType = is64Table ? _I64 : _I32;
    let r = this.popAndCheck1Type(addrType, 'return_call_indirect');
    r = combineResults(r, this.popAndCheckSignature(paramTypes, 'return_call_indirect'));
    r = combineResults(r, this.popAndCheckReturnCall(resultTypes, 'return_call_indirect'));
    return r;
  }

  onReturn(): Result {
    const label = this.getFuncLabel();
    if (!label) return Result.Error;
    const r = this.checkSignature(label.resultTypes, 'return');
    return combineResults(r, this.setUnreachable());
  }

  onDrop(): Result {
    return this.dropTypes(1);
  }

  onSelect(resultTypes: Type[]): Result {
    let r = this.popAndCheck1Type(_I32, 'select');
    if (resultTypes.length > 0) {
      const rt = resultTypes[0] ?? Type.Any;
      r = combineResults(r, this.popAndCheck2Types(rt, rt, 'select'));
      this.pushType(rt);
    } else {
      const t2 = this.peekType(0);
      const t1 = this.peekType(1);
      r = combineResults(r, this.dropTypes(2));
      this.pushType(t1 !== Type.Any ? t1 : t2);
    }
    return r;
  }

  onLocalGet(type: Type): Result {
    this.pushType(type);
    return Result.Ok;
  }

  onLocalSet(type: Type): Result {
    return this.popAndCheck1Type(type, 'local.set');
  }

  onLocalTee(type: Type): Result {
    const r = this.popAndCheck1Type(type, 'local.tee');
    this.pushType(type);
    return r;
  }

  onGlobalGet(type: Type): Result {
    this.pushType(type);
    return Result.Ok;
  }

  onGlobalSet(type: Type): Result {
    return this.popAndCheck1Type(type, 'global.set');
  }

  onRefNull(type: Type): Result {
    this.pushType(type);
    return Result.Ok;
  }

  onRefIsNull(): Result {
    const r = this.dropTypes(1);
    this.pushType(_I32);
    return r;
  }

  onRefFunc(): Result {
    this.pushType(Type.FuncRef);
    return Result.Ok;
  }

  onRefAsNonNull(): Result {
    const actual = this.peekType(0);
    const r = this.dropTypes(1);
    this.pushType(actual !== Type.Any ? actual : Type.FuncRef);
    return r;
  }

  onMemorySize(is64: boolean): Result {
    this.pushType(is64 ? _I64 : _I32);
    return Result.Ok;
  }

  onMemoryGrow(is64: boolean): Result {
    const t = is64 ? _I64 : _I32;
    const r = this.popAndCheck1Type(t, 'memory.grow');
    this.pushType(t);
    return r;
  }

  onMemoryCopy(dst64: boolean, src64: boolean): Result {
    const dstAddr = dst64 ? _I64 : _I32;
    const srcAddr = src64 ? _I64 : _I32;
    return this.popAndCheck3Types(dstAddr, srcAddr, dstAddr, 'memory.copy');
  }

  onMemoryFill(is64: boolean): Result {
    const t = is64 ? _I64 : _I32;
    return this.popAndCheck3Types(t, _I32, t, 'memory.fill');
  }

  onMemoryInit(is64: boolean): Result {
    const t = is64 ? _I64 : _I32;
    return this.popAndCheck3Types(t, _I32, _I32, 'memory.init');
  }

  onDataDrop(): Result {
    return Result.Ok;
  }

  onTableGet(elemType: Type): Result {
    const r = this.popAndCheck1Type(_I32, 'table.get');
    this.pushType(elemType);
    return r;
  }

  onTableSet(elemType: Type): Result {
    return this.popAndCheck2Types(_I32, elemType, 'table.set');
  }

  onTableGrow(elemType: Type): Result {
    const r = this.popAndCheck2Types(elemType, _I32, 'table.grow');
    this.pushType(_I32);
    return r;
  }

  onTableSize(): Result {
    this.pushType(_I32);
    return Result.Ok;
  }

  onTableFill(elemType: Type): Result {
    return this.popAndCheck3Types(_I32, elemType, _I32, 'table.fill');
  }

  onTableCopy(is64Dst: boolean, is64Src: boolean): Result {
    const dst = is64Dst ? _I64 : _I32;
    const src = is64Src ? _I64 : _I32;
    return this.popAndCheck3Types(dst, src, dst, 'table.copy');
  }

  onTableInit(is64: boolean): Result {
    const t = is64 ? _I64 : _I32;
    return this.popAndCheck3Types(t, _I32, _I32, 'table.init');
  }

  onElemDrop(): Result {
    return Result.Ok;
  }

  onThrow(sig: Type[]): Result {
    const r = this.popAndCheckSignature(sig, 'throw');
    return combineResults(r, this.setUnreachable());
  }

  onThrowRef(): Result {
    const r = this.popAndCheck1Type(Type.ExnRef, 'throw_ref');
    return combineResults(r, this.setUnreachable());
  }

  onRethrow(): Result {
    return this.setUnreachable();
  }

  onTry(paramTypes: Type[], resultTypes: Type[]): Result {
    const r = this.popAndCheckSignature(paramTypes, 'try');
    this.pushLabel(LabelType.Try, paramTypes, resultTypes);
    this.pushTypes(paramTypes);
    return r;
  }

  onCatch(sig: Type[]): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    let r = Result.Ok;
    if (label.labelType !== LabelType.Try && label.labelType !== LabelType.Catch) {
      this.printError('catch outside of try block');
      r = Result.Error;
    } else {
      r = combineResults(r, this.popAndCheckSignature(label.resultTypes, 'try block'));
      r = combineResults(r, this.checkTypeStackEnd('try block'));
      this.resetTypeStackToLabel(label);
      label.labelType = LabelType.Catch;
      label.unreachable = false;
      this.pushTypes(sig);
    }
    return r;
  }

  onDelegate(_depth: number): Result {
    const label = this.topLabel();
    if (!label) return Result.Error;
    let r = this.popAndCheckSignature(label.resultTypes, 'try block');
    r = combineResults(r, this.checkTypeStackEnd('try block'));
    this.resetTypeStackToLabel(label);
    this.pushTypes(label.resultTypes);
    r = combineResults(r, this.popLabel());
    return combineResults(r, this.setUnreachable());
  }

  onUnreachable(): Result {
    return this.setUnreachable();
  }

  onSimdLaneOp(_opcode: number, _lane: number): Result {
    const r = this.dropTypes(1);
    this.pushType(_V128);
    return r;
  }

  onSimdLoadLane(_is64: boolean): Result {
    const r = this.popAndCheck2Types(_I32, _V128, 'simd_load_lane');
    this.pushType(_V128);
    return r;
  }

  onSimdStoreLane(_is64: boolean): Result {
    return this.popAndCheck2Types(_I32, _V128, 'simd_store_lane');
  }

  onSimdShuffleOp(): Result {
    const r = this.popAndCheck2Types(_V128, _V128, 'v128.shuffle');
    this.pushType(_V128);
    return r;
  }
}
