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

import { combineResults, Result } from '../core/result.ts';
import { ExternalKind } from '../core/binary.ts';
import { addError, makeErrorList, unknownLocation } from '../core/error.ts';
import type { ErrorList, Location } from '../core/error.ts';
import type { Expr, Func, Module, Var } from './ir.ts';
import { varIndex } from './ir.ts';
import { heapTypeNameToType } from '../core/types.ts';

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

/**
 * Walk a {@link Module} and rewrite every name-form {@link Var}
 * (`{ kind: 'name', name: '$foo' }`) to its index-form (`{ kind: 'index',
 * value: N }`). The binary writer always expects index-form vars; name-form
 * vars left behind silently encode as index 0 (Bug G regression history).
 * Errors for unresolved names accumulate in `errors` rather than throwing.
 */
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

  // Note: no per-function `localScope` field — see resolveLocalVar.
  // wabt-ts's IR has no slot for param/local names, so resolveNames can't
  // do anything useful with name-vars in local refs. The WAT parser
  // resolves these at parse time; the binary reader produces only
  // index-vars.
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

    // Table initializer expressions (reference-types `(table … (init …))` /
    // the binary 0x40 form) carry name-bearing refs (e.g. `ref.func $f`) that
    // must be resolved, or the writer emits index 0 for them.
    for (const t of this.module.tables) {
      result = combine(result, this.resolveExprList(t.init));
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
      // The active-segment table reference can be a named, non-zero table
      // (`(elem (table $t) …)`); resolve it or the writer emits index 0.
      seg.tableVar = this.resolveTableVar(seg.tableVar);
      result = combine(result, this.resolveExprList(seg.offset));
      for (const elemExpr of seg.elemExprs) {
        result = combine(result, this.resolveExprList(elemExpr));
      }
    }

    for (const seg of this.module.dataSegments) {
      // Likewise the active-segment memory reference (`(data (memory $m) …)`).
      seg.memoryVar = this.resolveByKind(seg.memoryVar, ExternalKind.Memory);
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
        return [combine(rA, rC), {
          ...e,
          table: this.resolveTableVar(e.table, loc),
          typeVar: this.resolveTypeVar(e.typeVar, loc),
          args,
          callee,
        }];
      }
      case 'call_ref':
      case 'return_call_ref': {
        // `sigType` is the function-type immediate (`(call_ref $T …)`); it must
        // be resolved like `call_indirect`'s `typeVar`, or a named type that
        // isn't index 0 is left unresolved and the binary writer emits index 0.
        // The args + callee subtrees must be walked too.
        const [rA, args] = this.resolveExprArray(e.args);
        const [rC, callee] = this.resolveExpr(e.callee);
        return [combine(rA, rC), {
          ...e,
          sigType: this.resolveTypeVar(e.sigType, loc),
          args,
          callee,
        }];
      }
      case 'ref.func':
        return [Result.Ok, { ...e, func: this.resolveFuncVar(e.func, loc) }];
      case 'br': {
        // `br`'s optional carried value can be a full sub-expression (e.g. the
        // flat-form `br $l (call $f …)` or an operand routed here by the
        // linear parser's br value slot). It must be name-resolved too, or any
        // func/global/local name inside it is left unresolved and the writer
        // emits index 0.
        const target = this.resolveLabelVar(e.target, loc);
        if (e.value === undefined) return [Result.Ok, { ...e, target }];
        return [Result.Ok, { ...e, target, value: this.resolveExpr(e.value)[1] }];
      }
      case 'br_if': {
        const [r, cond] = this.resolveExpr(e.cond);
        const target = this.resolveLabelVar(e.target, loc);
        // Resolve the optional carried value as well — the flat-form parser can
        // route a real sub-expression (e.g. an `if` containing `call $f`) into
        // `br_if.value`; leaving it unresolved made the writer emit `call 0`.
        if (e.value === undefined) return [r, { ...e, target, cond }];
        return [r, { ...e, target, cond, value: this.resolveExpr(e.value)[1] }];
      }
      case 'br_table':
        return [Result.Ok, {
          ...e,
          targets: e.targets.map((t) => this.resolveLabelVar(t, loc)),
          defaultTarget: this.resolveLabelVar(e.defaultTarget, loc),
        }];
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
          // Resolve the catch's tag reference ($name → tag index); the
          // binary writer / validator read c.tag as an index. catch_all
          // clauses carry no tag.
          newCatches.push(
            c.tag === undefined
              ? { ...c, body: catchBody }
              : { ...c, tag: this.resolveTagVar(c.tag, loc), body: catchBody },
          );
        }
        this.labelStack.pop();
        // `delegate $target` references an outer label scope (the try's own
        // label is not in scope for it), so resolve it after the pop.
        if (e.delegate !== undefined) {
          return [result, {
            ...e,
            body,
            catches: newCatches,
            delegate: this.resolveLabelVar(e.delegate, loc),
          }];
        }
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
        return [combine(rD, combine(rS, rZ)), {
          ...e,
          segment: this.resolveDataSegVar(e.segment, loc),
          dest,
          src,
          size,
        }];
      }
      case 'data.drop':
        return [Result.Ok, { ...e, segment: this.resolveDataSegVar(e.segment, loc) }];
      case 'elem.drop':
        return [Result.Ok, { ...e, segment: this.resolveElemSegVar(e.segment, loc) }];
      case 'table.init': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, src] = this.resolveExpr(e.src);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), {
          ...e,
          segment: this.resolveElemSegVar(e.segment, loc),
          table: this.resolveTableVar(e.table, loc),
          dest,
          src,
          size,
        }];
      }
      case 'table.copy': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, srcOffset] = this.resolveExpr(e.srcOffset);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), {
          ...e,
          dst: this.resolveTableVar(e.dst, loc),
          src: this.resolveTableVar(e.src, loc),
          dest,
          srcOffset,
          size,
        }];
      }
      // --- Expression kinds with sub-expressions but no Var fields ---
      //
      // These previously fell through to `default: return e` unchanged,
      // which left every nested expression's name-vars unresolved. wasmtk
      // hit this with `(drop (call $f))` / `(select (call $f) ...)`: the
      // inner `call $f` kept its name var, the binary writer fell back to
      // index 0, and the produced binary called the wrong function.
      // Surfaced 2026-05-25.
      case 'drop': {
        const [r, val] = this.resolveExpr(e.value);
        return [r, { ...e, value: val }];
      }
      case 'select': {
        const [r1, val1] = this.resolveExpr(e.val1);
        const [r2, val2] = this.resolveExpr(e.val2);
        const [r3, cond] = this.resolveExpr(e.cond);
        return [combine(r1, combine(r2, r3)), { ...e, val1, val2, cond }];
      }
      case 'return': {
        if (e.values.length === 0) return [Result.Ok, e];
        let result: Result = Result.Ok;
        const values: Expr[] = [];
        for (const v of e.values) {
          const [r, resolved] = this.resolveExpr(v);
          result = combine(result, r);
          values.push(resolved);
        }
        return [result, { ...e, values }];
      }
      case 'unary':
      case 'convert': {
        const [r, operand] = this.resolveExpr(e.operand);
        return [r, { ...e, operand }];
      }
      case 'binary':
      case 'compare': {
        const [rL, left] = this.resolveExpr(e.left);
        const [rR, right] = this.resolveExpr(e.right);
        return [combine(rL, rR), { ...e, left, right }];
      }
      case 'ternary': {
        const [rA, a] = this.resolveExpr(e.a);
        const [rB, b] = this.resolveExpr(e.b);
        const [rC, c] = this.resolveExpr(e.c);
        return [combine(rA, combine(rB, rC)), { ...e, a, b, c }];
      }
      case 'quaternary': {
        const [rA, a] = this.resolveExpr(e.a);
        const [rB, b] = this.resolveExpr(e.b);
        const [rC, c] = this.resolveExpr(e.c);
        const [rD, d] = this.resolveExpr(e.d);
        return [combine(rA, combine(rB, combine(rC, rD))), { ...e, a, b, c, d }];
      }
      case 'load':
      case 'atomic_load':
      case 'load_splat':
      case 'load_zero': {
        const [r, address] = this.resolveExpr(e.address);
        return [r, { ...e, address }];
      }
      case 'store':
      case 'atomic_store':
      case 'atomic_rmw': {
        const [rA, address] = this.resolveExpr(e.address);
        const [rV, value] = this.resolveExpr(e.value);
        return [combine(rA, rV), { ...e, address, value }];
      }
      case 'atomic_rmw_cmpxchg': {
        const [rA, address] = this.resolveExpr(e.address);
        const [rE, expected] = this.resolveExpr(e.expected);
        const [rR, replacement] = this.resolveExpr(e.replacement);
        return [combine(rA, combine(rE, rR)), { ...e, address, expected, replacement }];
      }
      case 'atomic_wait': {
        const [rA, address] = this.resolveExpr(e.address);
        const [rE, expected] = this.resolveExpr(e.expected);
        const [rT, timeout] = this.resolveExpr(e.timeout);
        return [combine(rA, combine(rE, rT)), { ...e, address, expected, timeout }];
      }
      case 'atomic_notify': {
        const [rA, address] = this.resolveExpr(e.address);
        const [rC, count] = this.resolveExpr(e.count);
        return [combine(rA, rC), { ...e, address, count }];
      }
      case 'memory.grow': {
        const [r, delta] = this.resolveExpr(e.delta);
        return [r, { ...e, delta }];
      }
      case 'memory.copy': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rS, src] = this.resolveExpr(e.src);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rS, rZ)), { ...e, dest, src, size }];
      }
      case 'memory.fill': {
        const [rD, dest] = this.resolveExpr(e.dest);
        const [rV, value] = this.resolveExpr(e.value);
        const [rZ, size] = this.resolveExpr(e.size);
        return [combine(rD, combine(rV, rZ)), { ...e, dest, value, size }];
      }
      case 'table.get':
      case 'table.size':
        return [Result.Ok, { ...e, table: this.resolveTableVar(e.table, loc) }];
      case 'table.set': {
        const [rI, index] = this.resolveExpr(e.index);
        const [rV, value] = this.resolveExpr(e.value);
        return [combine(rI, rV), { ...e, table: this.resolveTableVar(e.table, loc), index, value }];
      }
      case 'table.grow': {
        const [rI, initValue] = this.resolveExpr(e.initValue);
        const [rD, delta] = this.resolveExpr(e.delta);
        return [combine(rI, rD), {
          ...e,
          table: this.resolveTableVar(e.table, loc),
          initValue,
          delta,
        }];
      }
      case 'table.fill': {
        const [rS, start] = this.resolveExpr(e.start);
        const [rV, value] = this.resolveExpr(e.value);
        const [rN, size] = this.resolveExpr(e.size);
        return [combine(rS, combine(rV, rN)), {
          ...e,
          table: this.resolveTableVar(e.table, loc),
          start,
          value,
          size,
        }];
      }
      case 'ref.is_null':
      case 'ref.as_non_null':
      case 'ref.i31': {
        const [r, value] = this.resolveExpr(e.value);
        return [r, { ...e, value }];
      }
      case 'i31.get': {
        const [r, i31] = this.resolveExpr(e.i31);
        return [r, { ...e, i31 }];
      }
      case 'ref.eq': {
        const [rl, left] = this.resolveExpr(e.left);
        const [rr, right] = this.resolveExpr(e.right);
        return [combineResults(rl, rr), { ...e, left, right }];
      }
      case 'struct.new': {
        const [r, operands] = this.resolveExprArray(e.operands);
        return [r, { ...e, typeVar: this.resolveTypeVar(e.typeVar, loc), operands }];
      }
      case 'struct.new_default':
        return [Result.Ok, { ...e, typeVar: this.resolveTypeVar(e.typeVar, loc) }];
      case 'struct.get': {
        const [r, ref] = this.resolveExpr(e.ref);
        const tv = this.resolveTypeVar(e.typeVar, loc);
        return [r, { ...e, typeVar: tv, fieldVar: this.resolveFieldVar(tv, e.fieldVar, loc), ref }];
      }
      case 'struct.set': {
        const [rr, ref] = this.resolveExpr(e.ref);
        const [rv, value] = this.resolveExpr(e.value);
        const tv = this.resolveTypeVar(e.typeVar, loc);
        return [
          combineResults(rr, rv),
          { ...e, typeVar: tv, fieldVar: this.resolveFieldVar(tv, e.fieldVar, loc), ref, value },
        ];
      }
      case 'array.new': {
        const [ri, init] = this.resolveExpr(e.init);
        const [rl, length] = this.resolveExpr(e.length);
        return [
          combineResults(ri, rl),
          { ...e, typeVar: this.resolveTypeVar(e.typeVar, loc), init, length },
        ];
      }
      case 'array.new_default': {
        const [r, length] = this.resolveExpr(e.length);
        return [r, { ...e, typeVar: this.resolveTypeVar(e.typeVar, loc), length }];
      }
      case 'array.new_fixed': {
        const [r, operands] = this.resolveExprArray(e.operands);
        return [r, { ...e, typeVar: this.resolveTypeVar(e.typeVar, loc), operands }];
      }
      case 'array.new_data': {
        const [ro, offset] = this.resolveExpr(e.offset);
        const [rl, length] = this.resolveExpr(e.length);
        return [combineResults(ro, rl), {
          ...e,
          typeVar: this.resolveTypeVar(e.typeVar, loc),
          dataVar: this.resolveDataSegVar(e.dataVar, loc),
          offset,
          length,
        }];
      }
      case 'array.new_elem': {
        const [ro, offset] = this.resolveExpr(e.offset);
        const [rl, length] = this.resolveExpr(e.length);
        return [combineResults(ro, rl), {
          ...e,
          typeVar: this.resolveTypeVar(e.typeVar, loc),
          elemVar: this.resolveElemSegVar(e.elemVar, loc),
          offset,
          length,
        }];
      }
      case 'array.get': {
        const [rr, ref] = this.resolveExpr(e.ref);
        const [ri, index] = this.resolveExpr(e.index);
        return [combineResults(rr, ri), {
          ...e,
          typeVar: this.resolveTypeVar(e.typeVar, loc),
          ref,
          index,
        }];
      }
      case 'array.set': {
        const [rr, ref] = this.resolveExpr(e.ref);
        const [ri, index] = this.resolveExpr(e.index);
        const [rv, value] = this.resolveExpr(e.value);
        return [combineResults(rr, combineResults(ri, rv)), {
          ...e,
          typeVar: this.resolveTypeVar(e.typeVar, loc),
          ref,
          index,
          value,
        }];
      }
      case 'array.len': {
        const [r, ref] = this.resolveExpr(e.ref);
        return [r, { ...e, ref }];
      }
      case 'ref.null':
        // `ref.null H` carries a HEAP type, not an item reference: abstract
        // keywords pass through for the writer to encode as a single negative
        // byte, `$T` resolves against the type scope. Before this case existed
        // the parser's name-var survived into the binary writer, which
        // rejected every `ref.null` as an unresolved name-var.
        return [Result.Ok, { ...e, refType: this.resolveHeapTypeVar(e.refType, loc) }];
      case 'ref.test':
      case 'ref.cast': {
        // The heapType var either names a user-defined heap type (resolve via
        // typeScope) or names an abstract heap type keyword ("any" / "i31" /
        // etc.) — leave abstract keywords as-is.
        const [r, ref] = this.resolveExpr(e.ref);
        return [r, { ...e, heapType: this.resolveHeapTypeVar(e.heapType, loc), ref }];
      }
      case 'throw_ref': {
        const [r, exnref] = this.resolveExpr(e.exnref);
        return [r, { ...e, exnref }];
      }
      case 'rethrow':
        // Legacy EH: `rethrow $label` / `rethrow N` targets an enclosing
        // try's catch. The depth is a label reference, so resolve it the
        // same way as a `br` target (numeric depths pass through unchanged).
        return [Result.Ok, { ...e, depth: this.resolveLabelVar(e.depth, loc) }];
      case 'br_on_null':
      case 'br_on_non_null': {
        const [r, value] = this.resolveExpr(e.value);
        return [r, { ...e, target: this.resolveLabelVar(e.target, loc), value }];
      }
      case 'simd_lane_op': {
        const [r, operand] = this.resolveExpr(e.operand);
        // `value` is the replace_lane scalar (undefined for extract_lane). It
        // can be a name-bearing sub-expr (e.g. `(global.get $g)`), so it must
        // be resolved too — globals are NOT resolved at parse time (only
        // locals are), so skipping it left `$g` as a name-var → index 0.
        if (e.value === undefined) return [r, { ...e, operand }];
        const [rv, value] = this.resolveExpr(e.value);
        return [combine(r, rv), { ...e, operand, value }];
      }
      case 'simd_shuffle': {
        const [rL, left] = this.resolveExpr(e.left);
        const [rR, right] = this.resolveExpr(e.right);
        return [combine(rL, rR), { ...e, left, right }];
      }
      case 'simd_load_lane':
      case 'simd_store_lane': {
        const [rA, address] = this.resolveExpr(e.address);
        const [rV, vec] = this.resolveExpr(e.vec);
        return [combine(rA, rV), { ...e, address, vec }];
      }
      // Truly leaf expressions or kinds the bridge / writer don't need to
      // recurse into. Returning `e` unchanged is safe.
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
      addError(this.errors, loc, `undefined ${kind} "${v.name}"`);
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
  private resolveTypeVar(v: Var, loc: Location = unknownLocation()): Var {
    return this.resolveVar(v, this.typeScope, 'type', loc);
  }
  /**
   * Resolve a heap-type var as used by `ref.test` / `ref.cast`. The var can
   * be either an abstract-heap-type keyword (`"any"` / `"eq"` / `"i31"` / etc.)
   * or a user-defined type name (`"$T"`). Abstract keywords pass through
   * unchanged; everything else is looked up in the typeScope.
   */
  private resolveHeapTypeVar(v: Var, loc: Location = unknownLocation()): Var {
    if (v.kind === 'index') return v;
    // Abstract heap-type keywords are not names in any index space — pass
    // them through untouched. Anything else is a user-defined `$T`.
    if (heapTypeNameToType(v.name) !== null) return v;
    return this.resolveTypeVar(v, loc);
  }
  /**
   * Resolve a `$fieldName` within a struct type. The field's index space is
   * scoped to the containing struct (unlike funcs / globals / etc. which are
   * module-global). Caller must pass the already-resolved type var so we can
   * look the struct up.
   */
  private resolveFieldVar(typeVar: Var, fieldVar: Var, loc: Location): Var {
    if (fieldVar.kind === 'index') return fieldVar;
    if (typeVar.kind !== 'index') {
      addError(this.errors, loc, `cannot resolve field "${fieldVar.name}" on unresolved type`);
      this.hadError = true;
      return fieldVar;
    }
    const typeEntry = this.module.types[typeVar.value];
    if (typeEntry === undefined || typeEntry.kind !== 'struct') {
      addError(
        this.errors,
        loc,
        `field "${fieldVar.name}" references non-struct type ${typeVar.value}`,
      );
      this.hadError = true;
      return fieldVar;
    }
    for (let i = 0; i < typeEntry.fields.length; i++) {
      if (typeEntry.fields[i]!.name === fieldVar.name) return varIndex(i);
    }
    addError(
      this.errors,
      loc,
      `undefined field "${fieldVar.name}" on struct type ${typeVar.value}`,
    );
    this.hadError = true;
    return fieldVar;
  }
  /**
   * Resolves a `local.get` / `local.set` / `local.tee` var. Index-vars pass
   * through unchanged. Name-vars produce a directive error: the IR has no
   * slot for param/local names (FuncSignature.params is Type[], LocalDecl is
   * { type, count }), so there's nowhere for resolveNames to look the name up.
   * The WAT parser resolves these at parse time; the binary reader produces
   * only index-vars. A name-var reaching here means hand-constructed IR
   * referencing names that aren't recoverable.
   */
  private resolveLocalVar(v: Var, loc: Location = unknownLocation()): Var {
    if (v.kind === 'index') return v;
    addError(
      this.errors,
      loc,
      `local "${v.name}" cannot be resolved at IR level — wabt-ts's IR has ` +
        `no slot for param/local names. Use the WAT parser (which resolves at ` +
        `parse time) or pass index-vars instead.`,
    );
    this.hadError = true;
    return v;
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
      addError(this.errors, loc, `undefined label "${v.name}"`);
      this.hadError = true;
      return v;
    }
    return varIndex(this.labelStack.length - 1 - depth);
  }

  private resolveByKind(v: Var, kind: ExternalKind): Var {
    switch (kind) {
      case ExternalKind.Func:
        return this.resolveFuncVar(v);
      case ExternalKind.Global:
        return this.resolveGlobalVar(v);
      case ExternalKind.Table:
        return this.resolveTableVar(v);
      case ExternalKind.Memory:
        return this.resolveVar(v, this.memScope, 'memory', unknownLocation());
      case ExternalKind.Tag:
        return this.resolveTagVar(v);
    }
  }
}

function combine(a: Result, b: Result): Result {
  return a === Result.Error || b === Result.Error ? Result.Error : Result.Ok;
}
