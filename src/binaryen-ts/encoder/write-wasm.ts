// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/encoder/write-wasm
 *
 * A binaryen-ts module — as read, as optimized, or as the API built it — to
 * bytes, through the ONE binary writer (wabt-ts's). One front end, stage 4.
 *
 * wabt-ts's writer takes a tree whose references are indices and whose every
 * type use names a type-section entry — what `wat2wasm` hands it after
 * `resolveNames` and `synthesizeTypes`. A tree the optimizer or the API made
 * references by NAME, and carries blocks and calls no type names yet. So the
 * same two steps run first — the "resolve step" of the plan (refinement 2) —
 * and they do nothing to what was written: an index as written stays
 * (`synthesizeTypes` keeps a written type while it still matches), and a type
 * is appended only where none exists, after every existing one.
 *
 * ⚠️ Those steps CHANGE the tree they run on (names to indices; types
 * appended), and binaryen-ts's passes need names. The caller's module may be
 * written and then optimized again (`Module.emitBinary`, `toBinary`), so they
 * run on a COPY.
 *
 * Parity, measured when it replaced binaryen-ts's encoder at the entry points:
 * over 2,919 inputs (the 421-module corpus and every spec module V8 accepts),
 * unoptimized and at -O1 / -O2 / -O3 / -Oz, all 14,595 outputs byte-identical
 * to `encodeWasm`'s — after the four defects the comparison found were fixed on
 * both sides (cmem/ir-convergence.md, One front end, stage 4).
 */

import { resolveNames } from '../../wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../wabt-ts/ir/synthesize-types.ts';
import { writeBinaryIr } from '../../wabt-ts/writer/binary-writer.ts';
import { writeWatModule } from '../../wabt-ts/writer/wat-writer.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../wabt-ts/core/error.ts';
import { FidelityTable } from '../../wabt-ts/ir/fidelity.ts';
import type { WasmModule } from '../ir/module.ts';
import { type Expression, ExpressionKind, type RegionExpr } from '../ir/expressions.ts';
import { mapChildrenShallow } from '../ir/walk.ts';
import { type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import { WasmEncodeError } from './wasm-encoder.ts';

/**
 * `m` as `.wasm` bytes. The module is not changed.
 *
 * Names are written when the module has them to write (`hasNameSection`) —
 * the encoder's rule: a pass run without `debugInfo` clears it.
 *
 * @throws {WasmEncodeError} when a reference names nothing the module has.
 */
export function writeWasm(m: WasmModule): Uint8Array {
  const copy = resolvedCopy(m);
  return writeBinaryIr(copy, { writeDebugNames: copy.hasNameSection });
}

/**
 * `m` as WAT text, through the one WAT writer (wabt-ts's `writeWatModule`),
 * after the same resolve step as {@link writeWasm}. The module is not changed.
 *
 * 🔧 `Module.toWat()` had its own partial serializer: it printed a `binary` as
 * its numeric opcode — `(106 (local.get 0) (local.get 1))` for `i32.add` — and
 * `(export "f" (function …))`, and threw on most kinds; `optimize(…, hybrid)`
 * handed that text to the `wasm-opt` subprocess (K4). The writer `wasm2wat`
 * uses already prints every kind.
 *
 * @throws {WasmEncodeError} when a reference names nothing the module has.
 */
export function writeWat(m: WasmModule): string {
  const copy = resolvedCopy(m);
  labelsToDepths(copy);
  // With every target a depth, the writer prints the NAME of a label that has
  // a real one (`namedLabelTargets`) and the depth of one that does not.
  return writeWatModule(copy, { namedLabelTargets: true });
}

/**
 * Every branch target written as a label NAME becomes its depth, in place.
 *
 * A tree made ready for the passes names every label (`nameReferences`),
 * including the ones it made up, and the WAT writer prints only REAL labels on
 * their constructs (owner decision 4). A branch that kept a made-up name came
 * out as `br $l0_0` beside a block with no `$l0_0`, and the text did not
 * assemble. The binary writer never met this: it resolves names itself.
 *
 * Scope is the spec's: a construct's label covers its REGIONS, not its
 * operands — an `if`'s condition, a carrier's entry values, a `try`'s
 * `delegate` and a `try_table`'s catch targets are all outside it — and the
 * function frame is the outermost level.
 */
function labelsToDepths(m: WasmModule): void {
  for (const f of m.functions) {
    const stack: string[] = [f.bodyFrameLabel ?? ''];
    const depth = (v: Var): Var => {
      if (v.kind !== 'name') return v;
      const at = stack.lastIndexOf(v.name);
      return at < 0 ? v : varIndex(stack.length - 1 - at);
    };
    const inside = (label: string, e: Expression): Expression => {
      stack.push(label);
      const r = visit(e);
      stack.pop();
      return r;
    };
    // A label prints as `$name`, and the WAT writer takes the sigil to be part
    // of the name. binaryen-ts names labels without one where a pass or the API
    // made them (`__inlined_func$…`, `makeLoop('l', …)`), and the first letter
    // was eaten: `(loop $"")`. References are depths by now, so a label's
    // spelling can change without touching them.
    const sigil = (label: string) => label === '' || label.startsWith('$') ? label : `$${label}`;
    const visit = (e: Expression): Expression => {
      const n = e as Expression & Record<string, unknown>;
      switch (e.kind) {
        case ExpressionKind.Region:
          return { ...e, children: e.children.map(visit) } as Expression;
        case ExpressionKind.Block: {
          const params = e.params ? { ...e.params, values: e.params.values.map(visit) } : undefined;
          stack.push(e.label);
          const children = e.children.map(visit);
          stack.pop();
          return {
            ...e,
            label: sigil(e.label),
            children,
            ...(params ? { params } : {}),
          } as Expression;
        }
        case ExpressionKind.Loop:
        case ExpressionKind.If:
        case ExpressionKind.Try:
        case ExpressionKind.TryTable: {
          const label = n.label as string;
          const catches = e.kind === ExpressionKind.TryTable
            ? { catches: e.catches.map((c) => ({ ...c, target: depth(c.target) })) }
            : {};
          const delegate = e.kind === ExpressionKind.Try && e.delegate !== undefined
            ? { delegate: depth(e.delegate) }
            : {};
          const mapped = mapChildrenShallow(
            e,
            (c) => c.kind === ExpressionKind.Region ? inside(label, c) : visit(c),
          );
          return { ...mapped, label: sigil(label), ...catches, ...delegate } as Expression;
        }
        case ExpressionKind.Break:
        case ExpressionKind.BrOn:
        case ExpressionKind.Rethrow:
          return { ...mapChildrenShallow(e, visit), target: depth(n.target as Var) } as Expression;
        case ExpressionKind.Switch:
          return {
            ...mapChildrenShallow(e, visit),
            targets: e.targets.map(depth),
            defaultTarget: depth(e.defaultTarget),
          } as Expression;
        default:
          return mapChildrenShallow(e, visit);
      }
    };
    f.body = visit(f.body) as RegionExpr;
  }
}

/** A copy of `m` with references resolved to indices and every type use named. */
function resolvedCopy(m: WasmModule): WasmModule {
  // A DEFINED global must have its initializer: the format has no spelling for
  // one without. The encoder refused it; wabt-ts's writers take a tree a parser
  // or reader made, which always has one, and printed `(global $g i32)` — text
  // that does not assemble. A pass or the API can leave it out (optional since
  // M2h), so it is refused here, before either writer, as the encoder did.
  for (const g of m.globals) {
    if (g.init === undefined) {
      throw new WasmEncodeError(`cannot write global ${g.name}: it has no initializer`);
    }
  }
  const copy = copyModule(m);
  const errors = makeErrorList();
  resolveNames(copy, errors);
  if (hasErrors(errors)) {
    throw new WasmEncodeError(`cannot write the module: ${formatErrors(errors).trim()}`);
  }
  synthesizeTypes(copy);
  if (copy.explicitNames === undefined) sigilEntityNames(copy);
  return copy;
}

/**
 * An entity name the API gave without its `$` gains one, in place.
 *
 * The writers take the `$` to be part of a name and drop the first character
 * — `b.addMemory('m')` printed `(memory $"" …)`, which does not assemble. A
 * module a reader made names everything with the sigil (real names and made-up
 * ones), and records which are real in `explicitNames`, so only a module with
 * no record — one the API built — is touched, and there every name is real,
 * with no record to keep in step. References are indices by now, so renaming a
 * definition moves nothing.
 */
function sigilEntityNames(m: WasmModule): void {
  const fix = (x: { name?: string }) => {
    if (x.name !== undefined && x.name !== '' && !x.name.startsWith('$')) x.name = `$${x.name}`;
  };
  for (const list of [m.types, m.functions, m.tables, m.memories, m.globals, m.tags]) {
    for (const x of list as { name?: string }[]) fix(x);
  }
  for (const list of [m.elements, m.dataSegments]) {
    for (const x of list as { name?: string }[]) fix(x);
  }
  for (const f of m.functions) for (const l of f.locals) fix(l);
  for (const imp of m.imports) {
    const entity = (imp as unknown as Record<string, { name?: string } | undefined>)[
      ['func', 'table', 'memory', 'global', 'tag'][imp.kind]!
    ];
    if (entity) fix(entity);
  }
}

/**
 * A structural copy of `m`: every array, object, `Map` and `Set` new, the
 * fidelity table cloned, byte payloads shared (nothing here writes into them).
 */
function copyModule(m: WasmModule): WasmModule {
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Uint8Array) return v;
    if (v instanceof FidelityTable) return v.clone();
    if (Array.isArray(v)) return v.map(copy);
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, copy(x)]));
    if (v instanceof Set) return new Set([...v].map(copy));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = copy(x);
    return out;
  };
  return copy(m) as WasmModule;
}
