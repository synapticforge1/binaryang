// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module wabt-ts/ir/name-references
 *
 * S6 step 5 item 6 (M8c): every reference binaryen-ts's passes read BY NAME
 * becomes a name — on the route to the optimizer only. It is what the bridge
 * did while rebuilding the module; measured over the corpus's 7,620 functions,
 * beyond derived types that was: `call` / `ref.func` targets, `global.get` /
 * `global.set`, branch targets (`br`, `br_if`, `br_table`, `br_on_*`,
 * `rethrow`, `delegate`, `try_table` catches), `call_indirect` tables, tags —
 * plus the start function, every export, and element segments' tables and
 * entries. Locals, memories, types and segment references stay indices, as the
 * bridge left them.
 *
 * Every entity and every label is NAMED first (owner decision 4, cmem/names.md)
 * — the reader already did that for a binary; for text it happens here, AFTER
 * `resolveNames` + `synthesizeTypes`, where a made-up `$func0` can no longer
 * satisfy a reference the author wrote (M7c3b's reason for not naming during
 * parsing). The names text wrote are recorded REAL; only those are ever written.
 *
 * Never run on the `wat2wasm` / `wasm2wat` routes: a name-form reference prints
 * as `$name` where the author wrote an index.
 */

import { ExternalKind } from '../core/binary.ts';
import { Result } from '../core/result.ts';
import { ExprVisitor, type ExprVisitorDelegate } from './expr-visitor.ts';
import { type Expr, type Func, type Module, totalFuncs, type Var, varName } from './ir.ts';
import { labelsOf, MADE_UP, nameEveryEntity, unique } from './made-up-names.ts';

/** A reference's name in `space`, from an index or a name as written. */
function nameIn(space: readonly string[], v: Var, what: string): Var {
  if (v.kind === 'name') return v;
  const n = space[v.value];
  if (n === undefined) throw new Error(`name-references: ${what} index ${v.value} is out of range`);
  return varName(n);
}

/** Each index space's names, imports first — as the binary numbers them. */
function spaces(m: Module) {
  const s = {
    funcs: [] as string[],
    globals: [] as string[],
    tables: [] as string[],
    memories: [] as string[],
    tags: [] as string[],
  };
  for (const imp of m.imports) {
    if (imp.kind === ExternalKind.Func) s.funcs.push(imp.func.name);
    else if (imp.kind === ExternalKind.Global) s.globals.push(imp.global.name);
    else if (imp.kind === ExternalKind.Table) s.tables.push(imp.table.name);
    else if (imp.kind === ExternalKind.Memory) s.memories.push(imp.memory.name);
    else if (imp.kind === ExternalKind.Tag) s.tags.push(imp.tag.name);
  }
  s.funcs.push(...m.functions.map((f) => f.name));
  s.globals.push(...m.globals.map((g) => g.name));
  s.tables.push(...m.tables.map((t) => t.name));
  s.memories.push(...m.memories.map((x) => x.name));
  s.tags.push(...m.tags.map((t) => t.name));
  return s;
}

type W<T> = { -readonly [K in keyof T]: T[K] };

/** Rewrites one function's (or constant expression's) references, tracking labels. */
class Namer implements ExprVisitorDelegate {
  /** The branch-target labels in scope, innermost last; the function frame at the bottom. */
  private readonly labels: string[];

  constructor(private readonly sp: ReturnType<typeof spaces>, frameLabel: string) {
    this.labels = [frameLabel];
  }

  private label(v: Var): Var {
    if (v.kind === 'name') return v;
    const idx = this.labels.length - 1 - v.value;
    const n = this.labels[idx];
    if (n === undefined) {
      throw new Error(`name-references: branch depth ${v.value} is out of range`);
    }
    return varName(n);
  }

  private push(e: { label: string }): Result {
    this.labels.push(e.label);
    return Result.Ok;
  }
  private pop(): Result {
    this.labels.pop();
    return Result.Ok;
  }

  beginBlockExpr(e: { label: string }): Result {
    return this.push(e);
  }
  endBlockExpr(): Result {
    return this.pop();
  }
  beginLoopExpr(e: { label: string }): Result {
    return this.push(e);
  }
  endLoopExpr(): Result {
    return this.pop();
  }
  beginIfExpr(e: { label: string }): Result {
    return this.push(e);
  }
  endIfExpr(): Result {
    return this.pop();
  }
  beginTryExpr(e: { label: string }): Result {
    return this.push(e);
  }
  endTryExpr(): Result {
    return this.pop();
  }
  /** A `try`'s catch tag — its label is in scope, as the bridge resolved it. */
  onCatchExpr(_e: unknown, c: { tag?: Var }): Result {
    if (c.tag !== undefined) (c as W<typeof c>).tag = nameIn(this.sp.tags, c.tag, 'catch tag');
    return Result.Ok;
  }
  /**
   * `delegate` resolves OUTSIDE the `try`'s own label, as `resolveNames`, the
   * binary writer and binaryen-ts's encoder all resolve it — so the label is
   * popped FIRST. (The bridge resolved it with the label still in scope, one
   * frame too deep; nothing in the corpus delegates.) The visitor returns after
   * this hook without calling `endTryExpr`, so this pop is the only one.
   */
  onDelegateExpr(e: { delegate?: Var }): Result {
    this.pop();
    if (e.delegate !== undefined) (e as W<typeof e>).delegate = this.label(e.delegate);
    return Result.Ok;
  }
  /** A `try_table`'s catch targets resolve OUTSIDE its own label (T13.22) — before the push. */
  beginTryTableExpr(e: { label: string; catches: { tag?: Var; target: Var }[] }): Result {
    for (const c of e.catches) {
      const w = c as W<typeof c>;
      if (c.tag !== undefined) w.tag = nameIn(this.sp.tags, c.tag, 'catch tag');
      w.target = this.label(c.target);
    }
    return this.push(e);
  }
  endTryTableExpr(): Result {
    return this.pop();
  }

  onBrExpr(e: { target: Var }): Result {
    (e as W<typeof e>).target = this.label(e.target);
    return Result.Ok;
  }
  onBrOnExpr(e: { target: Var }): Result {
    (e as W<typeof e>).target = this.label(e.target);
    return Result.Ok;
  }
  onBrTableExpr(e: { targets: Var[]; defaultTarget: Var }): Result {
    const w = e as W<typeof e>;
    w.targets = e.targets.map((t) => this.label(t));
    w.defaultTarget = this.label(e.defaultTarget);
    return Result.Ok;
  }
  onRethrowExpr(e: { target: Var }): Result {
    (e as W<typeof e>).target = this.label(e.target);
    return Result.Ok;
  }
  onCallExpr(e: { func: Var }): Result {
    (e as W<typeof e>).func = nameIn(this.sp.funcs, e.func, 'call');
    return Result.Ok;
  }
  onRefFuncExpr(e: { func: Var }): Result {
    (e as W<typeof e>).func = nameIn(this.sp.funcs, e.func, 'ref.func');
    return Result.Ok;
  }
  onCallIndirectExpr(e: { table: Var }): Result {
    (e as W<typeof e>).table = nameIn(this.sp.tables, e.table, 'call_indirect table');
    return Result.Ok;
  }
  onGlobalGetExpr(e: { var: Var }): Result {
    (e as W<typeof e>).var = nameIn(this.sp.globals, e.var, 'global.get');
    return Result.Ok;
  }
  onGlobalSetExpr(e: { var: Var }): Result {
    (e as W<typeof e>).var = nameIn(this.sp.globals, e.var, 'global.set');
    return Result.Ok;
  }
  onThrowExpr(e: { tag: Var }): Result {
    (e as W<typeof e>).tag = nameIn(this.sp.tags, e.tag, 'throw');
    return Result.Ok;
  }
}

/**
 * Name every entity and label, then rewrite every reference binaryen-ts's
 * passes read by name into that name. In place. See the module doc.
 */
export function nameReferences(m: Module): void {
  // A binary's reader named everything already; text is named here, after
  // resolution. Every function is listed in the local subsection, as the
  // writer lists them for a module read from text.
  if (m.explicitNames === undefined) {
    nameEveryEntity(m, new Set(Array.from({ length: totalFuncs(m) }, (_, i) => i)));
  }
  const sp = spaces(m);
  const importedFuncs = sp.funcs.length - m.functions.length;

  // A constant expression has no labels; `''` is a frame nothing can target.
  const constExpr = (e: Expr[]) => new ExprVisitor(new Namer(sp, '')).visitExprList(e);
  for (const g of m.globals) constExpr(g.init?.children ?? []);
  for (const t of m.tables) constExpr(t.init?.children ?? []);
  for (const d of m.dataSegments) constExpr(d.offset?.children ?? []);
  for (const seg of m.elements) {
    constExpr(seg.offset?.children ?? []);
    for (const entry of seg.elemExprs) constExpr(entry.children);
    // An ACTIVE segment's table is read by name (the bridge named it).
    if (seg.kind === 'active') {
      (seg as W<typeof seg>).tableVar = nameIn(sp.tables, seg.tableVar, 'element segment table');
    }
  }

  m.functions.forEach((f: Func, i) => {
    // The function frame is a branch target too: binaryen-ts's
    // `bodyFrameLabel`, made up — as its decoder makes it up — clear of every
    // label the function has, so no carrier's label can shadow it.
    const frame = unique(labelsOf(f), MADE_UP.frame(importedFuncs + i));
    f.bodyFrameLabel = frame;
    new ExprVisitor(new Namer(sp, frame)).visitFunc(f);
  });

  if (m.start !== undefined) m.start = nameIn(sp.funcs, m.start, 'start');
  for (const exp of m.exports) {
    const space = exp.kind === ExternalKind.Func
      ? sp.funcs
      : exp.kind === ExternalKind.Global
      ? sp.globals
      : exp.kind === ExternalKind.Table
      ? sp.tables
      : exp.kind === ExternalKind.Memory
      ? sp.memories
      : sp.tags;
    (exp as W<typeof exp>).var = nameIn(space, exp.var, 'export');
  }
}
