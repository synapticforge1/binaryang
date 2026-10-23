// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/passes/MergeSimilarFunctions.cpp
// Copyright 2021 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module passes/merge-similar-functions
 *
 * MergeSimilarFunctions (open-work 30, step 4; upstream runs it at -Oz): functions whose bodies
 * are the same but for some constants become ONE shared function that takes those constants as
 * extra parameters. Each original keeps its name, its index and its type, as a thunk:
 *
 *     (func $oob (param i32 i32 i32) …body using (i32.const 6) (i32.const 1049340)…)
 *     (func $sge (param i32 i32 i32) …the same body using (i32.const 1) (i32.const 1049100)…)
 *  →  (func $oob (param i32 i32 i32) (call $mgfn-shared$oob (local.get 0) (local.get 1) (local.get 2)
 *                                       (i32.const 6) (i32.const 1049340)))
 *     (func $sge … the same call, with (i32.const 1) (i32.const 1049100))
 *     (func $mgfn-shared$oob (param i32 i32 i32 i32 i32) …body using (local.get 3) (local.get 4)…)
 *
 * Zig's debug builds have one panic function per kind of failed check (`outOfBounds`,
 * `startGreaterThanEnd`, …), each building the same message from different constants.
 *
 * Upstream's rules, kept: same signature and same local types; the bodies equal but for constant
 * VALUES (their types must match), compared structurally with labels by position; a constant
 * that differs becomes a parameter, and constants that differ the same way across the class
 * share one; merged only when upstream's size estimate says it pays (`hasMergeBenefit`). Not
 * built: upstream also turns differing direct call targets into a `call_ref` of a parameter, with
 * GC enabled only. The thunk is a plain `call`, never `return_call`: the same size, and it needs
 * no tail-call support in the engine. Not merged: a function with several results, or one that
 * refers to a local by name (the shared function renumbers its locals).
 *
 * Reference: `WebAssembly/binaryen/src/passes/MergeSimilarFunctions.cpp`
 *
 * @license MIT
 */

import {
  type ConstExpr,
  type Expression,
  ExpressionKind,
  type Literal,
  makeBlock,
  makeCall,
  makeConst,
  makeLocalGet,
  makeRegion,
  type RegionExpr,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { varIndex, varName } from '../ir/ir.ts';
import { None } from '../ir/types.ts';
import { mapExpression, walkExpression } from '../ir/walk.ts';
import { makeTypeInterner } from '../ir/synthesize-types.ts';
import { deepKey } from './code-folding.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** Upstream's `MaxSyntheticFunctionParams`. */
const MAX_PARAMS = 255;

/** Merges functions that differ only in constants into one shared function and thunks. */
export class MergeSimilarFunctionsPass implements Pass {
  readonly name = 'MergeSimilarFunctions';
  readonly description =
    'Functions differing only in constants become one shared function taking them as parameters.';
  // The shared function has the primary's locals; a thunk has none.
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    _merge(module);
  }
}

registerPass(MergeSimilarFunctionsPass);

const _json = (v: unknown): string =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x));

/** The constants of `body`, in one fixed order (equal shapes give equal positions). */
function _constsOf(body: Expression): ConstExpr[] {
  const out: ConstExpr[] = [];
  walkExpression(body, (e) => {
    if (e.kind === ExpressionKind.Const) out.push(e);
  });
  return out;
}

/**
 * A function's shape with constant VALUES left out (their types kept): equal keys for functions
 * this pass may merge, `null` for one it must not touch.
 */
function _shapeKey(fn: WasmFunction): string | null {
  if (fn.sig.results.length > 1) return null;
  let byName = false;
  walkExpression(fn.body, (e) => {
    if (
      (e.kind === ExpressionKind.LocalGet || e.kind === ExpressionKind.LocalSet ||
        e.kind === ExpressionKind.LocalTee) && e.var.kind !== 'index'
    ) byName = true;
  });
  if (byName) return null;
  // A constant's VALUE left out; its node's own `type` still tells `i32.const` from
  // `i64.const`, so one parameter never has to take two types.
  const blanked = mapExpression(
    fn.body,
    (e) => e.kind === ExpressionKind.Const ? { ...e, value: null as unknown as Literal } : e,
  );
  // The frame label as a DECLARED one, so a branch to it compares by position: each function's
  // frame has its own name.
  const keyed = makeBlock((blanked as RegionExpr).children, fn.bodyFrameLabel ?? null);
  return `${_json(fn.sig)}|${_json(fn.locals.map((l) => l.type))}|${deepKey(keyed)}`;
}

/** A parameter of the shared function: one constant per function of the class, and where it is used. */
interface Param {
  values: Literal[];
  key: string;
  uses: ConstExpr[];
}

function _merge(module: WasmModule): void {
  const classes = new Map<string, WasmFunction[]>();
  for (const fn of module.functions) {
    const key = _shapeKey(fn);
    if (key === null) continue;
    classes.set(key, [...(classes.get(key) ?? []), fn]);
  }
  const names = new Set<string>(module.functions.map((f) => f.name));
  const intern = makeTypeInterner(module);
  const ordered = [...classes.values()].filter((c) => c.length >= 2)
    .sort((a, b) => (a[0]!.name < b[0]!.name ? -1 : a[0]!.name > b[0]!.name ? 1 : 0));

  for (const fns of ordered) {
    const primary = fns[0]!;
    const consts = fns.map((f) => _constsOf(f.body));
    const params: Param[] = [];
    for (let k = 0; k < consts[0]!.length; k++) {
      const values = consts.map((c) => c[k]!.value);
      const key = values.map(_json).join(',');
      if (values.every((v) => _json(v) === _json(values[0]))) continue;
      const same = params.find((p) => p.key === key);
      if (same) same.uses.push(consts[0]![k]!);
      else params.push({ values, key, uses: [consts[0]![k]!] });
    }
    if (!_pays(primary, fns.length, params.length)) continue;

    // The shared function: the primary's body, each parameterized constant read from its new
    // parameter, every local past the parameters moved up by as many.
    const nParams = primary.sig.params.length;
    const paramOf = new Map<ConstExpr, number>();
    params.forEach((p, i) => {
      for (const u of p.uses) paramOf.set(u, nParams + i);
    });
    const body = mapExpression(primary.body, (e) => {
      if (e.kind === ExpressionKind.Const) {
        const at = paramOf.get(e);
        return at === undefined ? e : makeLocalGet(varIndex(at), e.value.type);
      }
      if (
        (e.kind === ExpressionKind.LocalGet || e.kind === ExpressionKind.LocalSet ||
          e.kind === ExpressionKind.LocalTee) && e.var.kind === 'index' && e.var.value >= nParams
      ) return { ...e, var: varIndex(e.var.value + params.length) };
      return e;
    }) as RegionExpr;
    let name = `mgfn-shared$${primary.name}`;
    for (let i = 0; names.has(name); i++) name = `mgfn-shared$${primary.name}$${i}`;
    names.add(name);
    const sig = {
      params: [...primary.sig.params, ...params.map((p) => p.values[0]!.type)],
      results: [...primary.sig.results],
    };
    module.functions.push({
      name,
      sig,
      typeVar: varIndex(intern(sig)),
      // `locals` is EVERY local, the parameters first: the new parameters go between.
      locals: [
        ...primary.locals.slice(0, nParams).map((l) => ({ ...l })),
        ...params.map((p) => ({ type: p.values[0]!.type })),
        ...primary.locals.slice(nParams).map((l) => ({ ...l })),
      ],
      body,
      ...(primary.bodyFrameLabel !== undefined ? { bodyFrameLabel: primary.bodyFrameLabel } : {}),
    });

    // Each original: a thunk passing its parameters on, then its own constants.
    const result = primary.sig.results[0] ?? None;
    fns.forEach((fn, i) => {
      const args = [
        ...fn.sig.params.map((t, p) => makeLocalGet(varIndex(p), t)),
        ...params.map((p) => makeConst(p.values[i]!)),
      ];
      fn.body = makeRegion([makeCall(varName(name), args, result)]);
      fn.locals = fn.locals.slice(0, fn.sig.params.length); // its parameters, nothing more
    });
  }
}

/**
 * Upstream's `hasMergeBenefit`: the nodes the class stops repeating against the glue its thunks
 * add (a call, a `local.get` per parameter, a constant per extra parameter) and the entries a new
 * function costs in the code and function sections.
 */
function _pays(primary: WasmFunction, funcCount: number, extra: number): boolean {
  if (extra + primary.sig.params.length > MAX_PARAMS) return false;
  let size = 0;
  walkExpression(primary.body, () => size++);
  const removed = (funcCount - 1) * size;
  const added = funcCount * (1 + primary.sig.params.length + extra) +
    funcCount * (extra * 1 + 2) +
    funcCount * 2;
  return added < removed;
}
