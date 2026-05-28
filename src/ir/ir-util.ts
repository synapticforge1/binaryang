// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/ir-util.h, src/ir-util.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Utilities for working with the wabt-ts IR: label stacks, expression arity
 * queries, and module traversal helpers.
 */

import { Type } from '../core/types.ts';
import type { Index } from '../core/types.ts';
import { ExternalKind } from '../core/binary.ts';
import type {
  BlockExpr,
  BlockType,
  Expr,
  Func,
  FuncSignature,
  IfExpr,
  LoopExpr,
  Module,
  TryExpr,
  TryTableExpr,
  Var,
} from './ir.ts';
import { varIndex } from './ir.ts';

// ---------------------------------------------------------------------------
// LabelType — what kind of control structure created this label
// ---------------------------------------------------------------------------

export enum LabelType {
  Func = 'func',
  Block = 'block',
  Loop = 'loop',
  If = 'if',
  Else = 'else',
  Try = 'try',
  Catch = 'catch',
  TryTable = 'try_table',
}

// ---------------------------------------------------------------------------
// Label — an entry on the label stack
// ---------------------------------------------------------------------------

export interface Label {
  name: string;
  labelType: LabelType;
  paramTypes: readonly Type[];
  resultTypes: readonly Type[];
}

interface BlockArity {
  paramTypes: readonly Type[];
  resultTypes: readonly Type[];
}

// ---------------------------------------------------------------------------
// ModuleContext — provides arity queries and a label stack
// ---------------------------------------------------------------------------

export class ModuleContext {
  readonly module: Module;

  private currentFunc: Func | null = null;
  private labelStack: Label[] = [];

  // Flat index → signature maps built once at construction. They replace the
  // O(imports) linear scans previously done on every getFuncSig/getTagArity
  // call, which mattered because getExprArity calls them for every expression
  // during validator and writer walks. Imports come first (in declaration
  // order, matching the index space), then defined funcs/tags.
  private readonly funcSigsByIndex: FuncSignature[];
  private readonly tagArityByIndex: number[];

  constructor(module: Module) {
    this.module = module;

    const funcSigs: FuncSignature[] = [];
    const tagArity: number[] = [];
    for (const imp of module.imports) {
      if (imp.kind === ExternalKind.Func) {
        funcSigs.push(imp.func.sig);
      } else if (imp.kind === ExternalKind.Tag) {
        tagArity.push(imp.tag.sig.params.length);
      }
    }
    for (const f of module.funcs) funcSigs.push(f.sig);
    for (const t of module.tags) tagArity.push(t.sig.params.length);
    this.funcSigsByIndex = funcSigs;
    this.tagArityByIndex = tagArity;
  }

  get labelStackSize(): Index {
    return this.labelStack.length;
  }

  // --- Label stack ---

  beginFunc(func: Func): void {
    this.currentFunc = func;
    this.labelStack = [];
    const { params, results } = func.sig;
    this.labelStack.push({
      name: '',
      labelType: LabelType.Func,
      paramTypes: params,
      resultTypes: results,
    });
  }

  endFunc(): void {
    this.labelStack.pop();
    this.currentFunc = null;
  }

  beginBlock(label: string, labelType: LabelType, blockType: BlockType): void {
    const { paramTypes, resultTypes } = this.resolveBlockType(blockType);
    this.labelStack.push({ name: label, labelType, paramTypes, resultTypes });
  }

  endBlock(): void {
    this.labelStack.pop();
  }

  getLabel(v: Var): Label | undefined {
    if (v.kind === 'index') {
      const depth = v.value;
      const idx = this.labelStack.length - 1 - depth;
      return idx >= 0 ? this.labelStack[idx] : undefined;
    }
    for (let i = this.labelStack.length - 1; i >= 0; i--) {
      const label = this.labelStack[i];
      if (label !== undefined && label.name === v.name) return label;
    }
    return undefined;
  }

  // --- Arity helpers ---

  /** Number of values consumed and produced by expr (nargs, nreturns). */
  getExprArity(expr: Expr): { nargs: number; nreturns: number; unreachable: boolean } {
    switch (expr.kind) {
      case 'nop':
        return { nargs: 0, nreturns: 0, unreachable: false };
      case 'unreachable':
        return { nargs: 0, nreturns: 0, unreachable: true };
      case 'const':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'local.get':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'global.get':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'memory.size':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'table.size':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'ref.null':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'ref.func':
        return { nargs: 0, nreturns: 1, unreachable: false };
      case 'atomic_fence':
        return { nargs: 0, nreturns: 0, unreachable: false };
      case 'data.drop':
        return { nargs: 0, nreturns: 0, unreachable: false };
      case 'elem.drop':
        return { nargs: 0, nreturns: 0, unreachable: false };
      case 'code_metadata':
        return { nargs: 0, nreturns: 0, unreachable: false };
      case 'drop':
        return { nargs: 1, nreturns: 0, unreachable: false };
      case 'local.set':
        return { nargs: 1, nreturns: 0, unreachable: false };
      case 'global.set':
        return { nargs: 1, nreturns: 0, unreachable: false };
      case 'table.set':
        return { nargs: 2, nreturns: 0, unreachable: false };
      case 'memory.grow':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'local.tee':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'unary':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'convert':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'ref.is_null':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'ref.as_non_null':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'table.get':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'table.grow':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'binary':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'compare':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'load':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'store':
        return { nargs: 2, nreturns: 0, unreachable: false };
      case 'atomic_load':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'atomic_store':
        return { nargs: 2, nreturns: 0, unreachable: false };
      case 'atomic_rmw':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'atomic_rmw_cmpxchg':
        return { nargs: 3, nreturns: 1, unreachable: false };
      case 'atomic_wait':
        return { nargs: 3, nreturns: 1, unreachable: false };
      case 'atomic_notify':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'load_splat':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'load_zero':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'simd_lane_op':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'simd_shuffle':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'simd_load_lane':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'simd_store_lane':
        return { nargs: 2, nreturns: 0, unreachable: false };
      case 'memory.copy':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'memory.fill':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'memory.init':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'table.copy':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'table.init':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'table.fill':
        return { nargs: 3, nreturns: 0, unreachable: false };
      case 'select':
        return { nargs: 3, nreturns: 1, unreachable: false };
      case 'ternary':
        return { nargs: 3, nreturns: 1, unreachable: false };
      case 'quaternary':
        return { nargs: 4, nreturns: 1, unreachable: false };
      case 'call': {
        const sig = this.getFuncSig(expr.func);
        return { nargs: sig.params.length, nreturns: sig.results.length, unreachable: false };
      }
      case 'call_indirect':
      case 'return_call_indirect':
        return {
          nargs: expr.sig.params.length + 1,
          nreturns: expr.sig.results.length,
          unreachable: expr.kind === 'return_call_indirect',
        };
      case 'call_ref':
      case 'return_call_ref': {
        const sig = this.getTypeSig(expr.sigType);
        return {
          nargs: sig.params.length + 1,
          nreturns: sig.results.length,
          unreachable: expr.kind === 'return_call_ref',
        };
      }
      case 'return_call':
        return { nargs: this.getFuncSig(expr.func).params.length, nreturns: 0, unreachable: true };
      case 'return':
        return { nargs: this.currentFunc?.sig.results.length ?? 0, nreturns: 0, unreachable: true };
      case 'br':
        return { nargs: this.getBranchArity(expr.target), nreturns: 0, unreachable: true };
      case 'br_if':
        return {
          nargs: this.getBranchArity(expr.target) + 1,
          nreturns: this.getBranchArity(expr.target),
          unreachable: false,
        };
      case 'br_table':
        return {
          nargs: this.getBranchArity(expr.defaultTarget) + 1,
          nreturns: 0,
          unreachable: true,
        };
      case 'br_on_null':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'br_on_non_null':
        return { nargs: 1, nreturns: 0, unreachable: false };
      case 'block':
      case 'loop':
      case 'if':
      case 'try':
      case 'try_table': {
        const bt = (expr as BlockExpr | LoopExpr | IfExpr | TryExpr | TryTableExpr).blockType;
        return { nargs: 0, nreturns: this.blockTypeResultCount(bt), unreachable: false };
      }
      case 'throw':
        return { nargs: this.getTagArity(expr.tag), nreturns: 0, unreachable: true };
      case 'throw_ref':
        return { nargs: 1, nreturns: 0, unreachable: true };
      case 'rethrow':
        return { nargs: 0, nreturns: 0, unreachable: true };
      case 'ref.eq':
        return { nargs: 2, nreturns: 1, unreachable: false };
      case 'ref.i31':
        return { nargs: 1, nreturns: 1, unreachable: false };
      case 'i31.get':
        return { nargs: 1, nreturns: 1, unreachable: false };
      default: {
        const _exhaust: never = expr;
        return { nargs: 0, nreturns: 0, unreachable: false };
      }
    }
  }

  private resolveBlockType(bt: BlockType): BlockArity {
    if (bt.kind === 'void') return { paramTypes: [], resultTypes: [] };
    if (bt.kind === 'value') return { paramTypes: [], resultTypes: [bt.type] };
    const te = this.module.types[bt.typeIdx];
    if (te?.kind === 'func') return { paramTypes: te.sig.params, resultTypes: te.sig.results };
    return { paramTypes: [], resultTypes: [] };
  }

  private blockTypeResultCount(bt: BlockType): number {
    if (bt.kind === 'void') return 0;
    if (bt.kind === 'value') return 1;
    const te = this.module.types[bt.typeIdx];
    if (te?.kind === 'func') return te.sig.results.length;
    return 0;
  }

  private getFuncSig(v: Var): FuncSignature {
    if (v.kind !== 'index') return { params: [], results: [] };
    return this.funcSigsByIndex[v.value] ?? { params: [], results: [] };
  }

  private getTypeSig(v: Var): FuncSignature {
    if (v.kind !== 'index') return { params: [], results: [] };
    const te = this.module.types[v.value];
    if (te?.kind === 'func') return te.sig;
    return { params: [], results: [] };
  }

  private getTagArity(v: Var): number {
    if (v.kind !== 'index') return 0;
    return this.tagArityByIndex[v.value] ?? 0;
  }

  private getBranchArity(v: Var): number {
    const label = this.getLabel(v);
    if (!label) return 0;
    return label.labelType === LabelType.Loop ? label.paramTypes.length : label.resultTypes.length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function exprKindName(kind: Expr['kind']): string {
  return kind;
}

export function labelVar(depth: Index): Var {
  return varIndex(depth);
}
