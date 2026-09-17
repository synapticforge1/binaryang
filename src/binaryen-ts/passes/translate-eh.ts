/**
 * @module binaryen-ts/passes/translate-eh
 *
 * Translates legacy exception handling — `try` / `catch` / `catch_all` /
 * `delegate` / `rethrow` — into the standardised form: `try_table` (with
 * `catch` / `catch_ref` / `catch_all` / `catch_all_ref`) and `throw_ref`.
 *
 * Mirrors `WebAssembly/binaryen/src/passes/TranslateEH.cpp`
 * (`--translate-to-exnref`). Why it exists here: Wasmtime and Wasmer refuse
 * legacy EH outright ("legacy_exceptions feature required for try instruction",
 * no `-W` switch), so this is the one way a legacy-EH binary reaches them
 * through binaryang. Opt-in, as upstream: no optimization level runs it.
 *
 * The shapes are upstream's, one construct at a time:
 *
 * ```wat
 * (try $t (result T) (do BODY)          (block $t (result T)
 *   (catch $e CATCH)          =>          (block $catch (result E)
 *   (catch_all ALL))                        (br $t (try_table (result T)
 *                                                 (catch $e $catch) (catch_all $catch_all)
 *                                             BODY)))
 *                                           CATCH (br $t))   ;; see below
 *                                         ALL)
 * ```
 *
 * with `rethrow $t` becoming `throw_ref (local.get $exn)` — the clause turns
 * into `catch_ref` / `catch_all_ref` and stores the exnref first — and
 * `delegate $t` becoming `try_table (catch_all_ref $trampoline)`, where the
 * target's body is wrapped as `throw_ref (block $trampoline (result exnref) …)`.
 *
 * 🔑 **Where this departs from upstream: no scratch or tuple locals for a
 * catch's values** (divergence H1, `cmem/divergences.md`). Upstream stores a
 * tag's payload in a scratch local and rewrites each `pop` into a `local.get`,
 * and needs TUPLE locals plus `tuple.extract` when the payload has several
 * values or travels with an exnref. binaryen-ts has no tuple kinds (S6 6A); its
 * `Pop` is a stack placeholder that encodes to nothing, and a catch region
 * already starts with one per tag parameter. So a catch body is spliced in
 * directly after the block that delivers its values, and its `Pop`s consume
 * them exactly where the legacy `catch` left them. The same placeholder carries
 * an exnref into its local (`local.set $exn (pop exnref)`, the value on top) and
 * a split multi-value result into a `br`.
 *
 * Two more things upstream's IR settles that binaryen-ts's decoder leaves raw,
 * and so this pass resolves them itself:
 *
 * - **A `br` may target a legacy `try`'s own label** (its end). The outermost
 *   replacement node takes the try's name, so such a branch still lands at the
 *   same point.
 * - **A `delegate` may name any enclosing label**, not only a try. As upstream's
 *   IRBuilder does, it resolves outward to the nearest try whose BODY encloses
 *   that label — a catch region does not count — or to the caller.
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  labelName,
  makeBlock,
  makeBreak,
  makeLocalGet,
  makeLocalSet,
  makePop,
  makeRegion,
  makeReturn,
  makeThrowRef,
  makeTryTable,
  type RegionExpr,
  type RethrowExpr,
  type TableCatch,
  type TryExpr,
  typeOf,
} from '../ir/expressions.ts';
import type { ValueType } from '../ir/gc-types.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { None, Unreachable, ValType } from '../ir/types.ts';
import { mapChildrenShallow, visitChildren, walkExpression } from '../ir/walk.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { type BlockResult, type Var, varIndex, varName } from '../../wabt-ts/ir/ir.ts';

/** Translates legacy EH instructions into `try_table` / `throw_ref`. */
export class TranslateToExnrefPass implements Pass {
  readonly name = 'TranslateToExnref';
  readonly description =
    'Translates legacy EH (try / catch / catch_all / delegate / rethrow) into try_table and throw_ref.';
  readonly requiresNonNullableLocalFixups = true;

  run(module: WasmModule, _options: PassOptions): void {
    const paramsOf = tagParamsResolver(module);
    for (const fn of module.functions) translateFunction(fn, paramsOf);
  }
}

registerPass(TranslateToExnrefPass);

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** A `delegate` that resolves past every try hands the exception to the caller. */
const CALLER = Symbol('delegate to caller');

/** Where a `delegate` sends its exception: the try whose handlers see it, or the caller. */
type DelegateDest = TryExpr | typeof CALLER;

/**
 * One enclosing label scope during the scan. A legacy `try` opens TWO kinds
 * under one label — its body (`try`), where a delegate to it is handled by its
 * catches, and each catch region (`catch`), where a rethrow to it is legal and a
 * delegate to it is not handled by it.
 */
type Scope =
  | { kind: 'func'; label: string }
  | { kind: 'label'; label: string | null }
  | { kind: 'try'; label: string | null; node: TryExpr }
  | { kind: 'catch'; label: string | null; node: TryExpr; clause: number };

/**
 * What the scan learns, keyed by NODE IDENTITY rather than by label, so a
 * shadowed or reused label name cannot resolve to the wrong construct. The
 * rewrite reads the original nodes, so the identities stay valid throughout.
 */
interface Analysis {
  /** Every label defined in the function, so new ones cannot collide. */
  labels: Set<string>;
  delegateDest: Map<TryExpr, DelegateDest>;
  /** Trys some delegate resolves to — each gets a trampoline block. */
  delegateTargets: Set<TryExpr>;
  /** Each rethrow's try and the catch clause it sits in. */
  rethrowDest: Map<RethrowExpr, { node: TryExpr; clause: number }>;
  /** For each rethrow-targeted try, the clauses whose bodies rethrow it — these become `*_ref`. */
  refClauses: Map<TryExpr, Set<number>>;
  /** Whether the function holds any legacy construct at all. */
  legacy: boolean;
}

function analyze(fn: WasmFunction): Analysis {
  const funcLabel = fn.bodyFrameLabel ?? '';
  const a: Analysis = {
    labels: new Set([funcLabel]),
    delegateDest: new Map(),
    delegateTargets: new Set(),
    rethrowDest: new Map(),
    refClauses: new Map(),
    legacy: false,
  };
  const scopes: Scope[] = [{ kind: 'func', label: funcLabel }];

  /** The innermost scope carrying `label`, by index, or a throw — the input names no such label. */
  const find = (label: string, what: string): number => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i]!.label === label) return i;
    throw new Error(`TranslateToExnref: ${what} names "${label}", which is not an enclosing label`);
  };

  const within = (scope: Scope, visit: () => void): void => {
    if (scope.label !== null) a.labels.add(scope.label);
    scopes.push(scope);
    visit();
    scopes.pop();
  };

  const scan = (e: Expression): void => {
    switch (e.kind) {
      case ExpressionKind.Try: {
        a.legacy = true;
        e.params?.values.forEach(scan);
        if (e.delegate !== undefined) {
          // Relative to the try's PARENT scope, so resolve before entering it.
          let i = find(labelName(e.delegate), 'a delegate');
          let dest: DelegateDest | undefined;
          for (; i >= 0 && dest === undefined; i--) {
            const s = scopes[i]!;
            if (s.kind === 'try') dest = s.node;
            else if (s.kind === 'func') dest = CALLER;
          }
          a.delegateDest.set(e, dest!); // scopes[0] is the function: the loop always settles
          if (dest !== CALLER) a.delegateTargets.add(dest!);
        }
        within({ kind: 'try', label: e.label, node: e }, () => scan(e.body));
        e.catches.forEach((c, clause) => {
          // Legacy EH has no `catch_ref`; a clause claiming one did not come from
          // a legacy module, and translating it would guess at its meaning.
          if (c.isRef) {
            throw new Error(
              'TranslateToExnref: a legacy try clause marked catch_ref is not legacy EH',
            );
          }
          within({ kind: 'catch', label: e.label, node: e, clause }, () => scan(c.body));
        });
        return;
      }
      case ExpressionKind.Rethrow: {
        a.legacy = true;
        const s = scopes[find(labelName(e.target), 'a rethrow')]!;
        if (s.kind !== 'catch') {
          throw new Error(
            `TranslateToExnref: rethrow "${labelName(e.target)}" is not inside a catch of that try`,
          );
        }
        a.rethrowDest.set(e, { node: s.node, clause: s.clause });
        let clauses = a.refClauses.get(s.node);
        if (!clauses) a.refClauses.set(s.node, clauses = new Set());
        clauses.add(s.clause);
        return;
      }
      case ExpressionKind.If:
        // The condition is evaluated before the `if` opens its label.
        e.params?.values.forEach(scan);
        scan(e.condition);
        within({ kind: 'label', label: e.label || null }, () => {
          scan(e.ifTrue);
          if (e.ifFalse) scan(e.ifFalse);
        });
        return;
      case ExpressionKind.Block:
      case ExpressionKind.Loop:
      case ExpressionKind.TryTable:
        within({ kind: 'label', label: e.label }, () => visitChildren(e, scan));
        return;
      default:
        visitChildren(e, scan);
    }
  };

  scan(fn.body);
  return a;
}

// ---------------------------------------------------------------------------
// Rewrite
// ---------------------------------------------------------------------------

function translateFunction(fn: WasmFunction, paramsOf: (tag: Var) => ValueType[]): void {
  const a = analyze(fn);
  if (!a.legacy) return;

  const fresh = (base: string): string => {
    let n = 0;
    while (a.labels.has(`${base}${n}`)) n++;
    const label = `${base}${n}`;
    a.labels.add(label);
    return label;
  };

  const trampolines = new Map<TryExpr, string>();
  const trampolineOf = (t: TryExpr): string => {
    let label = trampolines.get(t);
    if (label === undefined) trampolines.set(t, label = fresh('$eh_delegate'));
    return label;
  };
  let callerTrampoline: string | null = null;

  // Upstream's exnref-local assignment: one local per NESTING DEPTH of
  // rethrow-targeted trys, reused by siblings. A local is written on entry to a
  // catch and read only inside it, and a deeper targeted try uses a deeper local.
  const rethrowTargeted = new Set([...a.rethrowDest.values()].map((d) => d.node));
  const exnLocals: number[] = [];
  const exnLocalOf = new Map<TryExpr, number>();
  let depth = 0;

  const tx = (e: Expression): Expression => {
    if (e.kind === ExpressionKind.Try) return txTry(e);
    if (e.kind === ExpressionKind.Rethrow) {
      const exn = exnLocalOf.get(a.rethrowDest.get(e)!.node)!;
      return makeThrowRef(makeLocalGet(varIndex(exn), ValType.ExnRef));
    }
    return mapChildrenShallow(e, tx);
  };
  const txRegion = (r: RegionExpr): RegionExpr => mapChildrenShallow(r, tx) as RegionExpr;

  const txTry = (t: TryExpr): Expression => {
    const targeted = rethrowTargeted.has(t);
    if (targeted) {
      depth++;
      while (exnLocals.length < depth) {
        exnLocals.push(fn.locals.length);
        fn.locals.push({ type: ValType.ExnRef });
      }
      exnLocalOf.set(t, exnLocals[depth - 1]!);
    }
    let body = txRegion(t.body);
    const catchBodies = t.catches.map((c) => txRegion(c.body));
    if (targeted) depth--;

    const type = t.type!;
    const concrete = type !== None;
    // The outermost replacement node takes the try's own label, so a `br` to the
    // try still lands at its end.
    let outer: string | null = null;
    const outerName = (): string => outer ??= t.label || fresh('$eh_outer');

    // A delegate target: the delegates now branch to a trampoline inside its
    // body, which rethrows there — where this try's catches see it.
    const isDelegateTarget = a.delegateTargets.has(t);
    if (isDelegateTarget) {
      const trampoline = makeBlock(
        concrete
          ? [makeBreak(outerName(), null, [makeBlock(body.children, null, type)])]
          : [...body.children, makeBreak(outerName())],
        trampolineOf(t),
        ValType.ExnRef,
      );
      body = makeRegion([makeThrowRef(trampoline)], Unreachable);
    }

    if (t.delegate !== undefined || t.catches.length === 0) {
      const catches: TableCatch[] = [];
      if (t.delegate !== undefined) {
        const dest = a.delegateDest.get(t)!;
        const target = dest === CALLER
          ? (callerTrampoline ??= fresh('$eh_delegate_caller'))
          : trampolineOf(dest);
        catches.push({ target: varName(target), isRef: true });
      }
      if (!isDelegateTarget) return makeTryTable(t.label, body, catches, type);
      return makeBlock([makeTryTable(null, body, catches, type)], outerName(), type);
    }

    const clauses: TableCatch[] = t.catches.map((c, i) => ({
      ...(c.tag === undefined ? {} : { tag: c.tag }),
      target: varName(fresh(c.tag === undefined ? '$eh_catch_all' : '$eh_catch')),
      isRef: a.refClauses.get(t)?.has(i) ?? false,
    }));
    const tryTable = makeTryTable(null, body, clauses, type);
    const out = outerName();

    /** A catch body's instructions, followed by the branch out of the whole construct. */
    const leave = (children: Expression[]): Expression[] => {
      const last = children[children.length - 1];
      const lastType = last ? typeOf(last) : None;
      if (lastType === Unreachable) return children;
      if (!concrete) return [...children, makeBreak(out)];
      if (last && !Array.isArray(type) && lastType === type) {
        return [...children.slice(0, -1), makeBreak(out, null, [last])];
      }
      // The values are on the stack but not one node (a multi-value result, or a
      // value below a statement): placeholders hand them to the branch.
      const results: ValueType[] = Array.isArray(type) ? type : [type as ValueType];
      return [...children, makeBreak(out, null, results.map((r) => makePop(r)))];
    };

    let items: Expression[] = concrete
      ? [makeBreak(out, null, [tryTable])]
      : [tryTable, makeBreak(out)];
    clauses.forEach((clause, i) => {
      const params = clause.tag === undefined ? [] : paramsOf(clause.tag);
      const sent: ValueType[] = clause.isRef ? [...params, ValType.ExnRef] : params;
      const next: Expression[] = [makeBlock(items, labelName(clause.target), typeOfValues(sent))];
      if (clause.isRef) {
        // The exnref is on TOP of the delivered values; the catch body's own
        // `Pop`s then take the payload beneath it, as the legacy catch left it.
        next.push(makeLocalSet(varIndex(exnLocalOf.get(t)!), makePop(ValType.ExnRef)));
      }
      const children = catchBodies[i]!.children;
      next.push(...(i === clauses.length - 1 ? children : leave(children)));
      items = next;
    });
    return makeBlock(items, out, type);
  };

  fn.body = txRegion(fn.body);

  if (callerTrampoline !== null) {
    const results = fn.sig.results;
    const resultType = typeOfValues(results);
    const trampoline = makeBlock(
      results.length > 0
        ? [makeReturn([makeBlock(fn.body.children, null, resultType)])]
        : [...fn.body.children, makeReturn()],
      callerTrampoline,
      ValType.ExnRef,
    );
    fn.body = makeRegion([makeThrowRef(trampoline)], Unreachable);
  }

  // Fail loud: a legacy node left behind would reach an engine that refuses it.
  walkExpression(fn.body, (e) => {
    if (e.kind === ExpressionKind.Try || e.kind === ExpressionKind.Rethrow) {
      throw new Error(`TranslateToExnref: a ${e.kind} survived in function "${fn.name}"`);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The type a list of values has together: none, the one value's, or a tuple. */
function typeOfValues(values: readonly ValueType[]): BlockResult {
  if (values.length === 0) return None;
  return values.length === 1 ? values[0]! : [...values];
}

/** A tag reference's parameter types — imported tags first in the index space, as the encoder numbers them. */
function tagParamsResolver(module: WasmModule): (tag: Var) => ValueType[] {
  const all = [
    ...module.imports.filter((i) => i.kind === ExternalKind.Tag).map((i) => ({
      name: i.tag.name,
      params: i.tag.sig.params,
    })),
    ...module.tags.map((t) => ({ name: t.name, params: t.sig.params })),
  ];
  const byName = new Map(all.map((t) => [t.name, t.params]));
  return (tag) => {
    const params = tag.kind === 'index' ? all[tag.value]?.params : byName.get(tag.name);
    if (params === undefined) {
      throw new Error(
        `TranslateToExnref: unknown tag ${tag.kind === 'index' ? tag.value : `"${tag.name}"`}`,
      );
    }
    return params;
  };
}
