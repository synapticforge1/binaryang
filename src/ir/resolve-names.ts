// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/resolve-names.h, src/resolve-names.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Resolve symbolic name Vars to index Vars in the IR.
 *
 * The WAT parser emits `{ kind: 'name' }` Vars for symbolic references
 * (`$foo`, `$bar`). `resolveNames` walks the IR and resolves each name-based
 * Var to an `{ kind: 'index' }` Var by looking it up in the module's name
 * binding maps.
 *
 * Errors are accumulated in an {@link ErrorList} rather than thrown.
 */

import { Result } from '../core/result.ts';
import { ExternalKind } from '../core/binary.ts';
import { addError, makeErrorList, unknownLocation } from '../core/error.ts';
import type { ErrorList, Location } from '../core/error.ts';
import type { Module, Func, Expr, Var } from './ir.ts';
import { varIndex } from './ir.ts';

// ---------------------------------------------------------------------------
// Name binding map
// ---------------------------------------------------------------------------

class NameScope {
  private readonly map = new Map<string, number>();

  bind(name: string, index: number): boolean {
    if (this.map.has(name)) return false;
    this.map.set(name, index);
    return true;
  }

  resolve(name: string): number | undefined {
    return this.map.get(name);
  }
}

// ---------------------------------------------------------------------------
// resolveNames — entry point
// ---------------------------------------------------------------------------

export function resolveNames(module: Module, errors: ErrorList = makeErrorList()): Result {
  const ctx = new ResolveContext(module, errors);
  return ctx.resolveModule();
}

// ---------------------------------------------------------------------------
// ResolveContext
// ---------------------------------------------------------------------------

class ResolveContext {
  private readonly module: Module;
  private readonly errors: ErrorList;
  private hadError = false;

  private funcScope = new NameScope();
  private globalScope = new NameScope();
  private tableScope = new NameScope();
  private memScope = new NameScope();
  private tagScope = new NameScope();
  private typeScope = new NameScope();
  private elemSegScope = new NameScope();
  private dataSegScope = new NameScope();

  private localScope = new NameScope();
  private labelStack: string[] = [];

  constructor(module: Module, errors: ErrorList) {
    this.module = module;
    this.errors = errors;
  }

  resolveModule(): Result {
    this.buildModuleScopes();
    let result = Result.Ok;

    for (const g of this.module.globals) {
      result = combine(result, this.resolveExprList(g.init));
    }

    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Func) {
        result = combine(result, this.resolveFunc(imp.func));
      }
    }
    for (const func of this.module.funcs) {
      result = combine(result, this.resolveFunc(func));
    }

    for (const seg of this.module.elemSegments) {
      result = combine(result, this.resolveExprList(seg.offset));
      for (const elemExpr of seg.elemExprs) {
        result = combine(result, this.resolveExprList(elemExpr));
      }
    }

    for (const seg of this.module.dataSegments) {
      result = combine(result, this.resolveExprList(seg.offset));
    }

    for (const exp of this.module.exports) {
      exp.var = this.resolveByKind(exp.var, exp.kind);
    }

    if (this.module.start !== undefined) {
      this.module.start = this.resolveFuncVar(this.module.start);
    }

    return combine(result, this.hadError ? Result.Error : Result.Ok);
  }

  private buildModuleScopes(): void {
    for (const [i, t] of this.module.types.entries()) {
      if (t.name) this.typeScope.bind(t.name, i);
    }

    let funcIdx = 0;
    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Func) {
        if (imp.func.name) this.funcScope.bind(imp.func.name, funcIdx);
        funcIdx++;
      }
    }
    for (const [i, f] of this.module.funcs.entries()) {
      if (f.name) this.funcScope.bind(f.name, this.module.numFuncImports + i);
    }

    let globalIdx = 0;
    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Global) {
        if (imp.global.name) this.globalScope.bind(imp.global.name, globalIdx);
        globalIdx++;
      }
    }
    for (const [i, g] of this.module.globals.entries()) {
      if (g.name) this.globalScope.bind(g.name, this.module.numGlobalImports + i);
    }

    let tableIdx = 0;
    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Table) {
        if (imp.table.name) this.tableScope.bind(imp.table.name, tableIdx);
        tableIdx++;
      }
    }
    for (const [i, t] of this.module.tables.entries()) {
      if (t.name) this.tableScope.bind(t.name, this.module.numTableImports + i);
    }

    let memIdx = 0;
    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Memory) {
        if (imp.memory.name) this.memScope.bind(imp.memory.name, memIdx);
        memIdx++;
      }
    }
    for (const [i, m] of this.module.memories.entries()) {
      if (m.name) this.memScope.bind(m.name, this.module.numMemoryImports + i);
    }

    let tagIdx = 0;
    for (const imp of this.module.imports) {
      if (imp.kind === ExternalKind.Tag) {
        if (imp.tag.name) this.tagScope.bind(imp.tag.name, tagIdx);
        tagIdx++;
      }
    }
    for (const [i, t] of this.module.tags.entries()) {
      if (t.name) this.tagScope.bind(t.name, this.module.numTagImports + i);
    }

    for (const [i, s] of this.module.elemSegments.entries()) {
      if (s.name) this.elemSegScope.bind(s.name, i);
    }
    for (const [i, s] of this.module.dataSegments.entries()) {
      if (s.name) this.dataSegScope.bind(s.name, i);
    }
  }

  private resolveFunc(func: Func): Result {
    this.localScope = new NameScope();
    this.labelStack = [];
    return this.resolveExprList(func.body);
  }

  private resolveExprList(exprs: Expr[]): Result {
    let result = Result.Ok;
    for (let i = 0; i < exprs.length; i++) {
      const e = exprs[i];
      if (e === undefined) continue;
      const [r, resolved] = this.resolveExpr(e);
      exprs[i] = resolved;
      result = combine(result, r);
    }
    return result;
  }

  private resolveExpr(e: Expr): [Result, Expr] {
    const loc = e.loc;

    switch (e.kind) {
      case 'local.get':
        return [Result.Ok, { ...e, var: this.resolveLocalVar(e.var, loc) }];
      case 'local.set': {
        const [r, val] = this.resolveExpr(e.value);
        return [r, { ...e, var: this.resolveLocalVar(e.var, loc), value: val }];
      }
      case 'local.tee': {
        const [r, val] = this.resolveExpr(e.value);
        return [r, { ...e, var: this.resolveLocalVar(e.var, loc), value: val }];
      }
      case 'global.get':
        return [Result.Ok, { ...e, var: this.resolveGlobalVar(e.var, loc) }];
      case 'global.set': {
        const [r, val] = this.resolveExpr(e.value);
        return [r, { ...e, var: this.resolveGlobalVar(e.var, loc), value: val }];
      }
      case 'call': {
        const [r, args] = this.resolveExprArray(e.args);
        return [r, { ...e, func: this.resolveFuncVar(e.func, loc), args }];
      }
      case 'return_call': {
        const [r, args] = this.resolveExprArray(e.args);
        return [r, { ...e, func: this.resolveFuncVar(e.func, loc), args }];
      }
      case 'call_indirect':
      case 'return_call_indirect': {
        const [rA, args] = this.resolveExprArray(e.args);
        const [rC, callee] = this.resolveExpr(e.callee);
        return [combine(rA, rC), { ...e, table: this.resolveTableVar(e.table, loc), args, callee }];
      }
      case 'ref.func':
        return [Result.Ok, { ...e, func: this.resolveFuncVar(e.func, loc) }];
      case 'br':
        return [Result.Ok, { ...e, target: this.resolveLabelVar(e.target, loc) }];
      case 'br_if': {
        const [r, cond] = this.resolveExpr(e.cond);
        return [r, { ...e, target: this.resolveLabelVar(e.target, loc), cond }];
      }
      case 'br_table':
        return [Result.Ok, { ...e, targets: e.targets.map(t => this.resolveLabelVar(t, loc)), defaultTarget: this.resolveLabelVar(e.defaultTarget, loc) }];
      case 'block':
      case 'loop': {
        this.labelStack.push(e.label);
        const [r, body] = this.resolveExprArray(e.body);
        this.labelStack.pop();
        return [r, { ...e, body }];
      }
      case 'if': {
        const [rC, cond] = this.resolveExpr(e.cond);
        this.labelStack.push(e.label);
        const [rT, then_] = this.resolveExprArray(e.then_);
        const [rE, else_] = this.resolveExprArray(e.else_);
        this.labelStack.pop();
        return [combine(rC, combine(rT, rE)), { ...e, cond, then_, else_ }];
      }
      case 'try': {
        this.labelStack.push(e.label);
        const [rB, body] = this.resolveExprArray(e.body);
        let result = rB;
        const newCatches = [];
        for (const c of e.catches) {
          const [rC, catchBody] = this.resolveExprArray(c.body);
          result = combine(result, rC);
          newCatches.push({ ...c, body: catchBody });
        }
        this.labelStack.pop();
        return [result, { ...e, body, catches: newCatches }];
      }
      case 'try_table': {
        this.labelStack.push(e.label);
        const [r, body] = this.resolveExprArray(e.body);
        this.labelStack.pop();
        return [r, { ...e, body }];
      }
      case 'throw': {
        const [r, args] = this.resolveExprArray(e.args);
        return [r, { ...e, tag: this.resolveTagVar(e.tag, loc), args }];
      }
      case 'memory.init': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, src] = this.resolveExpr(e.src);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), { ...e, segment: this.resolveDataSegVar(e.segment, loc), dest, src, size }];
      }
      case 'data.drop':
        return [Result.Ok, { ...e, segment: this.resolveDataSegVar(e.segment, loc) }];
      case 'elem.drop':
        return [Result.Ok, { ...e, segment: this.resolveElemSegVar(e.segment, loc) }];
      case 'table.init': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, src] = this.resolveExpr(e.src);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), { ...e, segment: this.resolveElemSegVar(e.segment, loc), table: this.resolveTableVar(e.table, loc), dest, src, size }];
      }
      case 'table.copy': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, srcOffset] = this.resolveExpr(e.srcOffset);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), { ...e, dst: this.resolveTableVar(e.dst, loc), src: this.resolveTableVar(e.src, loc), dest, srcOffset, size }];
      }
      default:
        return [Result.Ok, e];
    }
  }

  private resolveExprArray(exprs: Expr[]): [Result, Expr[]] {
    let result = Result.Ok;
    const out: Expr[] = [];
    for (const e of exprs) {
      const [r, resolved] = this.resolveExpr(e);
      result = combine(result, r);
      out.push(resolved);
    }
    return [result, out];
  }

  // --- Var resolution helpers ---

  private resolveVar(v: Var, scope: NameScope, kind: string, loc: Location): Var {
    if (v.kind === 'index') return v;
    const idx = scope.resolve(v.name);
    if (idx === undefined) {
      addError(this.errors, loc, `undefined ${kind} "$${v.name}"`);
      this.hadError = true;
      return v;
    }
    return varIndex(idx);
  }

  private resolveFuncVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.funcScope, 'func', loc);
  }
  private resolveGlobalVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.globalScope, 'global', loc);
  }
  private resolveTableVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.tableScope, 'table', loc);
  }
  private resolveTagVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.tagScope, 'tag', loc);
  }
  private resolveLocalVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.localScope, 'local', loc);
  }
  private resolveElemSegVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.elemSegScope, 'elem segment', loc);
  }
  private resolveDataSegVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.dataSegScope, 'data segment', loc);
  }

  private resolveLabelVar(v: Var, loc: Location = unknownLocation()): Var {
    if (v.kind === 'index') return v;
    const depth = this.labelStack.lastIndexOf(v.name);
    if (depth === -1) {
      addError(this.errors, loc, `undefined label "$${v.name}"`);
      this.hadError = true;
      return v;
    }
    return varIndex(this.labelStack.length - 1 - depth);
  }

  private resolveByKind(v: Var, kind: ExternalKind): Var {
    switch (kind) {
      case ExternalKind.Func:   return this.resolveFuncVar(v);
      case ExternalKind.Global: return this.resolveGlobalVar(v);
      case ExternalKind.Table:  return this.resolveTableVar(v);
      case ExternalKind.Memory: return this.resolveVar(v, this.memScope, 'memory', unknownLocation());
      case ExternalKind.Tag:    return this.resolveTagVar(v);
    }
  }
}

function combine(a: Result, b: Result): Result {
  return a === Result.Error || b === Result.Error ? Result.Error : Result.Ok;
}
