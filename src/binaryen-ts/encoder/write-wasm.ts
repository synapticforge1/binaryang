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
 * both sides (cmem/ir-convergence.md, One front end, stage 4). That encoder was
 * deleted at 1.6.0 (stage 4b); this is the only binary writer.
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
import { requireIndex, type Var, varIndex } from '../../wabt-ts/ir/ir.ts';
import { Type } from '../../wabt-ts/core/types.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { None, Unreachable } from '../ir/types.ts';

/**
 * Thrown when a module cannot be written: a reference that names nothing, a
 * defined global with no initializer. It moved here from binaryen-ts's encoder,
 * deleted at 1.6.0 (One front end stage 4b).
 */
export class WasmEncodeError extends Error {
  /** @param message - What could not be written. The `name` is always `"WasmEncodeError"`. */
  constructor(message: string) {
    super(message);
    this.name = 'WasmEncodeError';
  }
}

/**
 * `m` as `.wasm` bytes. The module is not changed.
 *
 * Names are written when the module has them to write (`hasNameSection`) —
 * the encoder's rule: a pass run without `debugInfo` clears it.
 *
 * @throws {WasmEncodeError} when a reference names nothing the module has, or
 *   the module holds something the binary cannot spell (`checkForWriting`).
 */
export function writeWasm(m: WasmModule): Uint8Array {
  const copy = resolvedCopy(m);
  return writing(() => writeBinaryIr(copy, { writeDebugNames: copy.hasNameSection }));
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
  return writing(() => writeWatModule(copy, { namedLabelTargets: true }));
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

/** The frame's name where a tree gave it none: no `$`-name or `''` can equal it. */
const FRAME = '\u0000frame';

/**
 * A function with no frame label: its branches to the FRAME are named `''` —
 * binaryen-ts's rule (the API, its WAT parser; the encoder read
 * `bodyFrameLabel ?? ''`). An UNNAMED construct also has the label `''`, and
 * is never a branch target, so a `''` reference means the frame and nothing
 * else. `resolveNames` resolves a name to its innermost binder, so the frame
 * gets a name no construct has, and every `''` target is pointed at it.
 *
 * 🔧 When the encoder was deleted (1.6.0) this rule went with it: a `br` to the
 * frame was "undefined label". Seeding the frame as `''` instead made an
 * unnamed block between the branch and the frame CAPTURE it — valid wasm that
 * exits the block, not the function (`function_frame_label.test.ts`).
 */
function nameTheFrame(f: WasmModule['functions'][number]): void {
  if (f.bodyFrameLabel !== undefined) return;
  f.bodyFrameLabel = FRAME;
  const to = (v: Var): Var => v.kind === 'name' && v.name === '' ? { ...v, name: FRAME } : v;
  const visit = (e: Expression): Expression => {
    const mapped = mapChildrenShallow(e, visit);
    switch (mapped.kind) {
      case ExpressionKind.Break:
      case ExpressionKind.BrOn:
        return { ...mapped, target: to(mapped.target) } as Expression;
      case ExpressionKind.Switch:
        return {
          ...mapped,
          targets: mapped.targets.map(to),
          defaultTarget: to(mapped.defaultTarget),
        } as Expression;
      case ExpressionKind.TryTable:
        return {
          ...mapped,
          catches: mapped.catches.map((c) => ({ ...c, target: to(c.target) })),
        } as Expression;
      case ExpressionKind.Try:
        return mapped.delegate === undefined
          ? mapped
          : { ...mapped, delegate: to(mapped.delegate) } as Expression;
      default:
        return mapped;
    }
  };
  f.body = visit(f.body) as RegionExpr;
}

/** The storage types that make a `struct.get` / `array.get` signed or unsigned. */
const isPacked = (t: unknown): boolean => t === Type.I8 || t === Type.I16;

/**
 * What binaryen-ts's encoder refused or normalized and the wabt-ts writer
 * would write as it stands — done here, on the copy, before the writer (One
 * front end stage 4b, 1.6.0, when that encoder was deleted). A tree the READER
 * made never trips these; one a pass or the API built can:
 *
 * - `signed` on a `struct.get` / `array.get` means something only for a
 *   PACKED field, as in binaryen. 🔧 The writer honoured it literally, so an
 *   API-built `get` on an i32 field with `signed: false` came out `get_u`,
 *   which the engine refuses — live on `toBinary` / `emitBinary` since stage
 *   4a. It is dropped here where the field is not packed.
 * - a `get`'s type index out of range or of the wrong kind, and a field index
 *   out of range, are refused (the writer wrote the index as it stood);
 * - a value type the binary cannot spell (`none`, `unreachable`) on a local,
 *   param or result is refused;
 * - a block / loop / if / try / try_table typed `unreachable` is refused — a
 *   construct DECLARES its results, and writing it void gives it a
 *   declaration it does not have;
 * - a region anywhere but a region slot is refused — writing its children
 *   inline would change what the surrounding code consumes;
 * - a branch DEPTH past the labels that enclose it is refused;
 * - an alignment that is not a power of two up to 256 (exponent 8, the bound
 *   upstream binaryen reads) is refused.
 */
function checkForWriting(m: WasmModule): void {
  const fail = (msg: string): never => {
    throw new WasmEncodeError(msg);
  };
  const valueType = (t: unknown, where: string) => {
    if (t === None || t === Unreachable) fail(`cannot encode value type: ${t} (${where})`);
  };
  const typeEntry = (v: Var, family: 'struct' | 'array') => {
    const i = requireIndex(v, `${family}.get type`);
    const def = m.types[i];
    if (def === undefined) {
      return fail(
        `${family}.get: type index ${i} is out of range (module declares ${m.types.length} types)`,
      );
    }
    if (def.kind !== family) {
      return fail(`${family}.get: type index ${i} is a "${def.kind}" type, not a ${family}`);
    }
    return def;
  };
  for (const exp of m.exports) {
    if (!(exp.kind in ExternalKind) || typeof exp.kind !== 'number') {
      fail(`cannot encode export "${exp.name}": unknown export kind ${String(exp.kind)}`);
    }
  }
  for (const s of m.dataSegments) {
    if (s.kind !== 'active' && s.kind !== 'passive') {
      fail(
        `cannot encode data segment ${s.name}: a data segment is active or passive, never ${s.kind}`,
      );
    }
  }
  for (const f of m.functions) {
    f.sig.params.forEach((t) => valueType(t, `a param of ${f.name}`));
    f.sig.results.forEach((t) => valueType(t, `a result of ${f.name}`));
    f.locals.forEach((l) => valueType(l.type, `a local of ${f.name}`));
    let depth = 1; // the function frame
    const visit = (e: Expression): Expression => {
      const n = e as Expression & Record<string, unknown>;
      const align = n.align;
      if (typeof align === 'number') {
        const exponent = Math.log2(align);
        if (!Number.isInteger(exponent) || exponent < 0 || exponent > 8) {
          fail(`cannot encode alignment ${align}: not a power of two up to 256 (exponent 8)`);
        }
      }
      const target = (v: Var) => {
        if (v.kind === 'index' && v.value >= depth) {
          fail(`branch depth ${v.value} is outside the ${depth} enclosing labels`);
        }
      };
      switch (e.kind) {
        case ExpressionKind.Block:
        case ExpressionKind.Loop:
        case ExpressionKind.If:
        case ExpressionKind.Try:
        case ExpressionKind.TryTable: {
          if (n.type === Unreachable) {
            fail(
              'a block / loop / if / try / try_table typed `unreachable`: a construct declares ' +
                'its results (none, a value type, or several) — give it the type it stands for',
            );
          }
          // A construct's label covers its regions (a block: its children),
          // not its operands, delegate or catch targets.
          const slots = new Set<Expression>(
            e.kind === ExpressionKind.Loop
              ? [e.body]
              : e.kind === ExpressionKind.If
              ? [e.ifTrue, ...(e.ifFalse ? [e.ifFalse] : [])]
              : e.kind === ExpressionKind.Try
              ? [e.body, ...e.catches.map((c) => c.body)]
              : e.kind === ExpressionKind.TryTable
              ? [e.body]
              : [],
          );
          if (e.kind === ExpressionKind.TryTable) e.catches.forEach((c) => target(c.target));
          if (e.kind === ExpressionKind.Try && e.delegate !== undefined) target(e.delegate);
          if (e.kind === ExpressionKind.Block) {
            const params = e.params?.values.map(visit);
            depth++;
            const children = e.children.map(visit);
            depth--;
            return {
              ...e,
              children,
              ...(params ? { params: { ...e.params!, values: params } } : {}),
            } as Expression;
          }
          return mapChildrenShallow(e, (c) => {
            if (!slots.has(c)) return visit(c);
            depth++;
            const r = { ...c, children: (c as RegionExpr).children.map(visit) } as Expression;
            depth--;
            return r;
          });
        }
        case ExpressionKind.Region:
          return fail('a region outside a region slot');
        case ExpressionKind.Break:
        case ExpressionKind.BrOn:
          target(n.target as Var);
          return mapChildrenShallow(e, visit);
        case ExpressionKind.Switch:
          e.targets.forEach(target);
          target(e.defaultTarget);
          return mapChildrenShallow(e, visit);
        case ExpressionKind.StructGet: {
          const def = typeEntry(e.typeVar, 'struct');
          const field = def.kind === 'struct'
            ? def.fields[requireIndex(e.fieldVar, 'field')]
            : undefined;
          if (field === undefined) {
            const count = def.kind === 'struct' ? def.fields.length : 0;
            fail(
              `struct.get: field index ${
                requireIndex(e.fieldVar, 'field')
              } is out of range for type ${requireIndex(e.typeVar, 'type')} (${count} fields)`,
            );
          }
          const mapped = mapChildrenShallow(e, visit) as typeof e;
          if (e.signed === undefined || isPacked(field!.type)) return mapped;
          const { signed: _, ...plain } = mapped;
          return plain as Expression;
        }
        case ExpressionKind.ArrayGet: {
          const def = typeEntry(e.typeVar, 'array');
          const mapped = mapChildrenShallow(e, visit) as typeof e;
          if (e.signed === undefined || (def.kind === 'array' && isPacked(def.field.type))) {
            return mapped;
          }
          const { signed: _, ...plain } = mapped;
          return plain as Expression;
        }
        default:
          return mapChildrenShallow(e, visit);
      }
    };
    f.body = {
      ...f.body,
      children: f.body.children.map(visit),
    } as RegionExpr;
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
  for (const f of copy.functions) nameTheFrame(f);
  // A passive or declared segment has no table or memory: the binary spells
  // none, and the encoder never read one. binaryen-ts's WAT parser and the API
  // leave a placeholder there (`$table0` in a module with no table), which the
  // resolve step then refused — `(elem declare func $f)` could not be written
  // (1.6.0, found when the encoder went). It is not written; make it inert.
  for (const s of copy.elements) if (s.kind !== 'active') s.tableVar = varIndex(0);
  for (const s of copy.dataSegments) if (s.kind !== 'active') s.memoryVar = varIndex(0);
  const errors = makeErrorList();
  resolveNames(copy, errors);
  if (hasErrors(errors)) {
    throw new WasmEncodeError(`cannot write the module: ${formatErrors(errors).trim()}`);
  }
  synthesizeTypes(copy);
  checkForWriting(copy);
  if (copy.explicitNames === undefined) sigilEntityNames(copy);
  return copy;
}

/**
 * `write(copy)`, with anything the writer throws reported as a
 * {@link WasmEncodeError} — the one error `writeWasm` / `writeWat` throw, as
 * binaryen-ts's encoder threw only that. The writer's own refusals (a custom
 * section with no payload, a size past its field, an unknown export kind)
 * came out as a bare `Error`, `RangeError` or `TypeError`.
 */
function writing<T>(write: () => T): T {
  try {
    return write();
  } catch (e) {
    if (e instanceof WasmEncodeError) throw e;
    throw new WasmEncodeError(`cannot write the module: ${(e as Error).message ?? String(e)}`);
  }
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
