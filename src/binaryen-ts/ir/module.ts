/**
 * @module binaryen-ts/ir/module
 *
 * WebAssembly module structure and builder API.
 *
 * A {@link WasmModule} is the root container for all WASM definitions.
 * The {@link ModuleBuilder} class provides a fluent API for constructing
 * modules, mirroring the `BinaryenModule*` family of functions in the upstream
 * Binaryen C API (`WebAssembly/binaryen/src/binaryen-c.h`).
 *
 * @example
 * ```ts
 * import { ModuleBuilder, ValType } from "@jrmarcum/binaryang/ir/binaryen-ts";
 *
 * const mod = new ModuleBuilder()
 *   .addFunction("add", [ValType.I32, ValType.I32], [ValType.I32], (b) =>
 *     b.binary(BinaryOp.AddI32, b.localGet(0), b.localGet(1))
 *   )
 *   .addExport("add", "add")
 *   .build();
 * ```
 *
 * @license MIT
 */

import {
  asRegion,
  type Expression,
  makeRefFunc,
  makeRegion,
  type RegionExpr,
  type RegionInput,
} from './expressions.ts';
import { visitChildren } from './walk.ts';
import { None, type Type, ValType } from './types.ts';
import type { ValueType } from './gc-types.ts';
import type { TypeDef } from './gc-types.ts';
import {
  type Limits,
  type SegmentKind,
  type Var,
  varFromToken,
  varIndex,
} from '../../wabt-ts/ir/ir.ts';
import { FidelityTable } from '../../wabt-ts/ir/fidelity.ts';
import { unknownLocation } from '../../wabt-ts/core/error.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import type * as W from '../../wabt-ts/ir/ir.ts';
export type { ExplicitNames } from '../../wabt-ts/ir/ir.ts';
export type { TypeDef } from './gc-types.ts';

// ---------------------------------------------------------------------------
// Module-level definition types
// ---------------------------------------------------------------------------

/**
 * `def` with every name filled: a type given as `''` becomes `$typeN` (clear of
 * `used`), a field given as `''` becomes `$fieldN` — owner decision 4 names
 * every entity, types and fields included (M7c3b b0). The made-up names are in
 * no `explicitNames` set, so they are never written. A copy: the caller's
 * object is left as it was.
 */
function namedTypeDef(def: TypeDef, idx: number, used: ReadonlySet<string>): TypeDef {
  let name = def.name;
  if (name === '') {
    name = `$type${idx}`;
    for (let n = 1; used.has(name); n++) name = `$type${idx}.${n}`;
  }
  if (def.kind === 'func') return { ...def, name };
  const fields = def.kind === 'struct' ? def.fields : [def.field];
  // Unique within the type: a made-up `$field0` must not take the spelling of a
  // field the caller really named `$field0`, or it would be written as real.
  const fieldsUsed = new Set(fields.map((f) => f.name).filter((n) => n !== ''));
  const named = fields.map((f, j) => {
    if (f.name !== '') return f;
    let n = `$field${j}`;
    for (let k = 1; fieldsUsed.has(n); k++) n = `$field${j}.${k}`;
    fieldsUsed.add(n);
    return { ...f, name: n };
  });
  return def.kind === 'struct'
    ? { ...def, name, fields: named }
    : { ...def, name, field: named[0]! };
}

/**
 * {@link Limits} from sizes as the builder API takes them: a `number` or a
 * `bigint`, and `null` for no maximum (M2g).
 */
export function limitsOf(
  initial: number | bigint,
  max: number | bigint | null = null,
  flags: { isShared?: boolean; is64?: boolean } = {},
): Limits {
  const limits: Limits = {
    initial: BigInt(initial),
    isShared: flags.isShared ?? false,
    is64: flags.is64 ?? false,
  };
  if (max !== null) limits.max = BigInt(max);
  return limits;
}

/**
 * A single local variable declaration inside a function.
 * Params are also represented as locals (indices 0..params.length-1).
 *
 * ONE TYPE with wabt-ts's `Local` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `type` — Type of the local — a scalar/abstract type or a concrete typed reference.
 * - `name` — Optional name (for WAT output readability).
 */
export type Local = W.Local;

/**
 * A WASM function definition.
 * Mirrors `Function` in `WebAssembly/binaryen/src/wasm.h`.
 *
 * ONE TYPE with wabt-ts's `Func` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Internal name (used for calls and exports).
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `nodeId` — Handle into wabt-ts's fidelity table (`Module.fidelity`); a pass never sets it.
 * - `typeUse` — How the source text named the signature (wabt-ts's; text-form only).
 * - `sig` — The function's type — wabt-ts's `FuncSignature` (S6 step 5 item 6 (M6a)),
 *   as a tag's is since M2c. It was `params` and `results` side by side, which
 *   said the same thing in a second shape: every signature this tree compares,
 *   interns or writes is a `{ params, results }` pair.
 *
 *   The params are also the first `locals`, by index — that has not changed.
 * - `typeVar` — The type index the binary WROTE for this function — which of several
 *   identical types it uses (M8b4; wabt-ts's `Func.typeVar`). The encoder writes
 *   it while it still names a function type with this function's signature,
 *   and derives the index from `sig` otherwise — absent (built by the API), or
 *   stale (a pass changed the signature).
 * - `locals` — All locals including params. Additional locals start at params.length.
 * - `body` — The function's region — see {@link RegionExpr}.
 * - `bodyFrameLabel` — Label of the function's implicit outermost block — the target of a `br`
 *   that exits the whole function (depth = number of enclosing blocks). The
 *   binary parser records the frame's label here; the encoder seeds it at the
 *   bottom of its label stack so such a branch resolves to the correct depth
 *   instead of silently collapsing to the innermost frame. Optional.
 */
export type WasmFunction = W.Func;

/**
 * Import descriptor.
 * Mirrors `Import` in `WebAssembly/binaryen/src/wasm.h`.
 */
/**
 * An import: the entity it names, EMBEDDED — wabt-ts's union (S6 step 5 item 6
 * (M4)). An imported table is a {@link WasmTable}, an imported memory a
 * {@link WasmMemory}, and so on, so an import and a definition are the same
 * record, described once.
 *
 * 🔧 It was one flat record with every kind's fields as optionals
 * (`params?`, `initial?`, `shared?`, …). Flat optionals admit states no module
 * can have — a memory import with `results`, a global import with `shared` — and
 * they LOST what they had no field for: an imported table's `is64` (23 spec
 * binaries, refused since M2g rather than silently narrowed) and an imported
 * memory's page size had nowhere to go.
 *
 * The entity's INTERNAL NAME is the entity's own (`imp.func.name`); `module` and
 * `field` are the two names the host knows it by (wabt-ts's spelling; `field`
 * was `base`).
 *
 * ONE TYPE with wabt-ts's `Import` — an alias since M8b6.
 */
export type WasmImport = W.Import;

/** The internal name an import gives the entity it names (M4). */
export function importName(imp: WasmImport): string {
  switch (imp.kind) {
    case ExternalKind.Func:
      return imp.func.name;
    case ExternalKind.Table:
      return imp.table.name;
    case ExternalKind.Memory:
      return imp.memory.name;
    case ExternalKind.Global:
      return imp.global.name;
    case ExternalKind.Tag:
      return imp.tag.name;
  }
}

/**
 * Export descriptor.
 * Mirrors `Export` in `WebAssembly/binaryen/src/wasm.h`.
 *
 * ONE TYPE with wabt-ts's `Export` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — The name visible to the host.
 * - `var` — The exported entity — a NAME in this tree, as every reference a pass reads
 *   is (`requireName`); a `Var` so an index as written can be held too (S6
 *   step 5 item 6 (M2), wabt-ts's shape — the L1 / S2 precedent). It was
 *   `value: string`.
 * - `kind` — Which kind of entity is exported — wabt-ts's `ExternalKind`, whose value IS
 *   the binary's kind byte (S6 step 5 item 6 (M2e); the V1 precedent). It was a
 *   string (`'function'`, …) spelling the same five facts a second way.
 */
export type WasmExport = W.Export;

/**
 * A WASM global variable.
 *
 * ONE TYPE with wabt-ts's `Global` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Internal name used to reference this global from instructions.
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `type` — Value type of the global.
 * - `mutable` — Whether the global is writable via `global.set`.
 * - `init` — The initializer — a constant expression, held as a {@link RegionExpr} of
 *   exactly the instructions it is (owner, 2026-09-16, S6 step 5 item 6 (M2);
 *   wabt-ts's shape). It was one `Expression`, which cannot hold a sequence.
 *
 *   OPTIONAL, as wabt-ts's `Global.init` is (M2h): the one record also describes
 *   an IMPORTED global, which has none, so absent means MISSING — never an empty
 *   region, which is a present-but-empty initializer. A defined global without
 *   one is refused by the encoder.
 */
export type WasmGlobal = W.Global;

/**
 * A data segment (initializes a region of linear memory).
 *
 * ONE TYPE with wabt-ts's `DataSegment` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Segment name (for WAT output).
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `kind` — How the segment reaches its memory — wabt-ts's `SegmentKind` (M3): `active`
 *   at instantiation, `passive` for `memory.init`. (`declared` is an element
 *   segment's; the encoder refuses it here.) It was `passive: boolean`.
 * - `memoryVar` — The memory an ACTIVE segment initializes, as written — a name or an index
 *   (M3; it was `memory?: number`, omitted meaning 0). The binary distinguishes
 *   kind 0 (active, memory 0) from kind 2 (active, explicit index); the reader
 *   used to consume that index and drop it.
 * - `offset` — The offset — a constant expression as a {@link RegionExpr}, present exactly
 *   when the segment is active. ABSENT is a missing field, not `null` (M2).
 * - `data` — Raw bytes copied into linear memory.
 */
export type DataSegment = W.DataSegment;

/**
 * A linear memory definition.
 *
 * ONE TYPE with wabt-ts's `Memory` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Internal name used to reference the memory from instructions.
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `limits` — Its limits — wabt-ts's record (S6 step 5 item 6 (M2g)): sizes in pages as
 *   `bigint` (u64 on the wire for a 64-bit memory), `max` absent when unbounded,
 *   `isShared`, `is64`, and `pageSizeLog2` (custom-page-sizes) when declared.
 */
export type WasmMemory = W.Memory;

/**
 * A table definition (for indirect calls and reference types).
 *
 * ONE TYPE with wabt-ts's `Table` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Internal name used to reference the table from instructions.
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `elemType` — Element value type — a reference type.
 * - `limits` — Its limits, in elements — wabt-ts's record (M2g). A table64's are u64 on the
 *   wire; a table never has `isShared` or `pageSizeLog2`.
 * - `init` — The initializer every slot starts as, when the table declares one (the
 *   `0x40 0x00` form) — a constant expression, as the {@link RegionExpr} it is
 *   held in; ABSENT when it declares none (M2g, the M2 owner call).
 */
export type WasmTable = W.Table;

/**
 * A WASM exception tag (EH proposal).
 * A tag defines the type of an exception — its payload is a list of value types.
 *
 * ONE TYPE with wabt-ts's `Tag` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Internal name (used in `throw` and `try_table` catch clauses).
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `sig` — The tag's function type: its `params` are the exception payload; its
 *   `results` are empty in a valid module and kept as read for a validator to
 *   refuse (S6 step 5 item 6 (M2), wabt-ts's shape). It was `params` alone,
 *   which could not hold what an invalid binary said.
 */
export type WasmTag = W.Tag;

/**
 * An element segment (populates a table).
 */
/**
 * How an element segment reaches the table — the distinction the binary format
 * calls the segment's "kind".
 *
 * - `active` — copied into its table at instantiation. `offset` says where.
 * - `passive` — sits unused until a `table.init` copies from it.
 * - `declarative` — never copied anywhere. It exists so that a `ref.func` for
 *   the functions it lists is legal; a module using `ref.func` outside a
 *   function body needs one.
 *
 * ⚠️ This field did not exist, and the encoder wrote kind 0 (active, table 0)
 * unconditionally. Storing a passive or declarative segment would therefore
 * have emitted it as ACTIVE — writing into the table at instantiation when the
 * source said it must not — so the parser refused both rather than corrupt a
 * table. That refusal is what this field lifts.
 */
export type ElementSegmentMode = SegmentKind;

/**
 * ONE TYPE with wabt-ts's `ElemSegment` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — Segment name (for WAT output).
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `kind` — How the segment reaches its table — wabt-ts's `SegmentKind` (M3). It was
 *   `mode: ElementSegmentMode`, whose third member was spelled `declarative`.
 * - `tableVar` — The table an ACTIVE segment initializes, as written — a name or an index (M3).
 * - `offset` — Offset expression — index into the target table where copying begins.
 *
 *   Present exactly when `kind` is `active`; the other two kinds have nowhere
 *   to copy to, and the field is MISSING (it was `null`). A constant expression,
 *   held as a {@link RegionExpr} (M2).
 * - `elemType` — The segment's element type (M3). The funcidx form implies the NON-NULLABLE
 *   `(ref func)` — every entry is a function index, so none can be null — and
 *   the expression form with no reftype byte implies `funcref`; the spec draws
 *   that distinction between `(elem … $f)` and `(elem … funcref (ref.func $f))`,
 *   and a table of `(ref func)` does not accept a `funcref` segment.
 * - `elemExprs` — Each entry, a constant expression held as a {@link RegionExpr} — wabt-ts's
 *   shape (M3). It was `data: string[]`, function names, which could hold
 *   neither a `ref.null` entry (refused: it would have shifted every later table
 *   index) nor a global.get / GC entry, and lost the segment's element type.
 */
export type ElementSegment = W.ElemSegment;

/** One element-segment entry naming `func`: the `(ref.func $f)` region (M3). */
export function elemFuncEntry(func: string | Var): RegionExpr {
  return makeRegion([makeRefFunc(typeof func === 'string' ? varFromToken(func) : func)]);
}

/**
 * Every function NAME an element segment's entries reference, for a pass asking
 * what a table can reach. An entry that names a function by index, or does not
 * name one at all (`ref.null`), contributes nothing (M3).
 */
export function elemFuncNames(seg: ElementSegment): string[] {
  const out: string[] = [];
  const visit = (e: Expression): void => {
    if (e.kind === 'ref.func' && e.func.kind === 'name') out.push(e.func.name);
    visitChildren(e, visit);
  };
  for (const entry of seg.elemExprs) visit(entry);
  return out;
}

// ---------------------------------------------------------------------------
// Root module container
// ---------------------------------------------------------------------------

/**
 * The root container for all WASM definitions.
 * Analogous to `Module` in `WebAssembly/binaryen/src/wasm.h`.
 *
 * ONE TYPE with wabt-ts's `Module` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — The module's own name, `$`-prefixed — `''` when it has none. wabt-ts's
 *   `Module.name`, and upstream binaryen's `Module::name` (M7c3a). It is never
 *   made up, so it needs no entry in {@link WasmModule.explicitNames}; it is
 *   written (name subsection 0) when a name section is.
 * - `functions` — All locally-defined functions in declaration order.
 * - `globals` — All locally-defined globals in declaration order.
 * - `memories` — All linear-memory definitions (typically 0 or 1 entry pre-multi-memory).
 * - `tables` — All table definitions in declaration order.
 * - `elements` — Element segments that initialize tables.
 * - `dataSegments` — Data segments that initialize linear memory.
 * - `imports` — Imported entities (functions, globals, memories, tables).
 * - `exports` — Names exported to the host.
 * - `tags` — Exception tags (EH proposal).
 * - `start` — The start function (section 8) — a `Var`, wabt-ts's `Module.start` (M8b1):
 *   a name as every reference a pass reads is (`requireName`), or an index as
 *   written. ABSENT when the module has none (the M2 rule: absent = missing).
 *   It was `string | null`, a name or a numeric TOKEN in one string.
 *
 *   The start function runs at instantiation time, before any export is
 *   callable. It is a root of the module's reachability graph exactly like an
 *   export, so passes that prune unreachable definitions must seed from it.
 * - `types` — User-defined heap types (struct, array, func) for the GC proposal.
 * - `explicitNames` — The names the module was READ with — its `name` section — as opposed to
 *   the ones the decoder made up. N1 steps P4–P5 (cmem/names.md).
 *
 *   Every entity here is keyed by a name, so the decoder names the unnamed ones
 *   `$func3`, `$global0`, … The encoder must not write those into a name
 *   section — that would invent names, the fault `wasm2wat`'s `generateNames`
 *   had — so it writes only what is listed here. Upstream binaryen keeps the
 *   same distinction as `hasExplicitName`.
 *
 *   ONLY that (M7c3b b1a): whether a section is written is
 *   {@link WasmModule.hasNameSection}. Every producer that MAKES UP names sets
 *   it — the decoder always does, section or not. Absent means nothing was made
 *   up, so every non-empty name is real.
 * - `hasNameSection` — Whether a `name` section is written — wabt-ts's `Module.hasNameSection`
 *   (M7c3b b1a). It was the PRESENCE of {@link WasmModule.explicitNames}, one
 *   field holding two facts. The decoder sets it to whether the binary had one
 *   (a binary without must not gain one); `ModuleBuilder.build` to `false`, so
 *   an API-built module encodes as before; `PassRunner` clears it at the end of
 *   a run unless `debugInfo` is set — optimized output follows `-g`, as
 *   upstream. ⚠️ Set on a module with no record, it takes every non-empty name
 *   as real — including a type name `addType` made up.
 * - `hasDataCountSection` — Whether the module was decoded from a binary with a DataCount section (id
 *   12) — W6. The encoder writes one when a function body names a data segment
 *   (then the format requires it), or when this is set, so a binary that
 *   carried one it did not need re-encodes with it. False from
 *   {@link ModuleBuilder.build}. wabt-ts's `Module.hasDataCountSection` (M7c):
 *   one name, and one spelling of false.
 * - `customSections` — The custom sections the module was decoded from, in binary order — C3
 *   (cmem/divergences.md).
 *
 *   🔧 The decoder collected NONE, so a decode → encode dropped `producers`,
 *   `target_features`, `dylink.0` and every DWARF section outright, with no
 *   diagnostic. Upstream `wasm-opt` keeps them all, through `-O2`.
 *
 *   Each one records the position it held, so the module comes back as it went
 *   in — where upstream APPENDS them after the known sections and special-cases
 *   only `dylink.0` (which must come first). An API-built module has none: `[]`
 *   (required since M8b5, as wabt-ts's — one spelling of "none").
 * - `loc` — The module's AS-WRITTEN metadata — wabt-ts's `Module` fields, carried by
 *   the one module (M8b5): where it was defined, the file it came from, each
 *   section's byte range (`wasm-objdump`), and the text-form side table
 *   (`fidelity.ts`). Empty from {@link ModuleBuilder.build}, as
 *   `makeModule` leaves them. `PassRunner` clears `fidelity` and
 *   `sectionMeta` after a run with at least one pass: an optimized module has
 *   no original for them to describe — the design `fidelity.ts` records.
 */
export type WasmModule = W.Module;

/**
 * One custom section a module carried: its bytes and where they sat.
 *
 * The `name` section is the exception — the encoder GENERATES it from
 * {@link WasmModule.explicitNames}, so the entry for it only marks the PLACE,
 * with `data: null`. That is how a binary whose customs straddle the name
 * section (`.debug_*`, `name`, `producers` — clang's layout) re-encodes in the
 * order it arrived.
 *
 * ONE TYPE with wabt-ts's `Custom` — an alias since S6 step 5 item 6 (M8b6),
 * after M1–M8b5 converged the two declarations field by field (the ratchet,
 * `tests/ir/module_convergence.test.ts`, pins the identity). What binaryen-ts's
 * own declaration said is kept below, field by field.
 *
 * - `name` — The section's name: `producers`, `target_features`, `dylink.0`, `.debug_info`, …
 * - `loc` — Where the source defined it — wabt-ts's `loc`, optional in both (M8b3 / M8b4).
 * - `data` — Its payload, verbatim — or `null` for the `name` section's place.
 * - `precedingSection` — The known section this one FOLLOWED, or `null` when it came before every
 *   known section; ABSENT when the position is not known (built by hand), and
 *   then it is written last. Ids are the binary's own (1 type … 13 tag), so a
 *   section is written back into the same gap even if the neighbour it was
 *   recorded against is gone. wabt-ts's `Custom.precedingSection` (M2f).
 */
export type CustomSection = W.Custom;

/**
 * The as-written metadata of a module that was not read from anything — what
 * `ModuleBuilder.build` gives, and what wabt-ts's `makeModule` gives (M8b5).
 */
export function noAsWrittenMetadata(): Pick<
  WasmModule,
  'loc' | 'filename' | 'sectionMeta' | 'fidelity' | 'customSections'
> {
  return {
    loc: unknownLocation(),
    filename: '',
    sectionMeta: [],
    fidelity: new FidelityTable(),
    customSections: [],
  };
}

// ---------------------------------------------------------------------------
// ModuleBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for constructing {@link WasmModule} instances.
 *
 * All `add*` methods mutate the builder and return `this` for chaining.
 * Call {@link ModuleBuilder.build} to produce the final immutable module.
 *
 * @example
 * ```ts
 * const mod = new ModuleBuilder()
 *   .addMemory("mem0", 1, null)
 *   .addFunction("factorial", [ValType.I32], [ValType.I32], myBody)
 *   .addExport("factorial", "factorial")
 *   .build();
 * ```
 */
export class ModuleBuilder {
  private readonly _functions: WasmFunction[] = [];
  private readonly _globals: WasmGlobal[] = [];
  private readonly _memories: WasmMemory[] = [];
  private readonly _tables: WasmTable[] = [];
  private readonly _elements: ElementSegment[] = [];
  private readonly _dataSegments: DataSegment[] = [];
  private readonly _imports: WasmImport[] = [];
  private readonly _exports: WasmExport[] = [];
  private readonly _tags: WasmTag[] = [];
  private _start: Var | undefined;
  private readonly _types: TypeDef[] = [];

  // -------------------------------------------------------------------------
  // Functions
  // -------------------------------------------------------------------------

  /**
   * Adds a function to the module.
   *
   * @param name - Internal function name.
   * @param params - Parameter types.
   * @param results - Return types (empty = void).
   * @param body - The function body: a region, a list, or one expression
   *   (see {@link asRegion}).
   * @param locals - Additional (non-param) local variables.
   * @param paramNames - The params' names, by index; `undefined` for an unnamed
   *   one. A param is a local, so its name is its `Local.name` — the decoder
   *   passes the name section's here (N1 P4); without this they were dropped.
   */
  addFunction(
    name: string,
    params: ValueType[],
    results: ValueType[],
    body: RegionInput,
    locals: Local[] = [],
    bodyFrameLabel?: string,
    paramNames?: readonly (string | undefined)[],
  ): this {
    const paramLocals: Local[] = params.map((type, i) => {
      const n = paramNames?.[i];
      return n === undefined ? { type } : { type, name: n };
    });
    this._functions.push({
      name,
      sig: { params, results },
      locals: [...paramLocals, ...locals],
      body: asRegion(body),
      bodyFrameLabel,
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Globals
  // -------------------------------------------------------------------------

  /**
   * Adds a global variable.
   *
   * @param name - Internal global name.
   * @param type - Value type.
   * @param mutable - Whether the global can be mutated via `global.set`.
   * @param init - Constant initializer — an expression, a list, or a region; held
   *   as the {@link RegionExpr} a constant expression is (S6 step 5 item 6 (M2)).
   */
  addGlobal(name: string, type: ValueType, mutable: boolean, init: RegionInput): this {
    this._globals.push({ name, type, mutable, init: asRegion(init) });
    return this;
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  /**
   * Adds a linear memory.
   *
   * @param name - Internal memory name.
   * @param initial - Initial size in 64 KiB pages.
   * @param max - Maximum pages, or `null` for unbounded.
   * @param shared - Whether the memory is shared (threads proposal).
   * @param is64 - Whether the memory uses 64-bit addressing (memory64 proposal).
   */
  addMemory(
    name: string,
    initial: number | bigint | Limits,
    max: number | bigint | null = null,
    shared = false,
    is64 = false,
  ): this {
    const limits = typeof initial === 'object'
      ? initial
      : limitsOf(initial, max, { isShared: shared, is64 });
    this._memories.push({ name, limits });
    return this;
  }

  /**
   * Adds an active data segment that initializes a region of linear memory.
   *
   * @param name - Segment name.
   * @param offset - Constant offset expression (e.g. `makeI32Const(0)`).
   * @param data - Raw bytes.
   */
  addDataSegment(
    name: string,
    offset: RegionInput,
    data: Uint8Array,
    memory: number | Var = 0,
  ): this {
    this._dataSegments.push({
      name,
      kind: 'active',
      memoryVar: typeof memory === 'number' ? varIndex(memory) : memory,
      offset: asRegion(offset),
      data,
    });
    return this;
  }

  /**
   * Adds a passive data segment (not auto-applied; used with `memory.init`).
   */
  addPassiveDataSegment(name: string, data: Uint8Array): this {
    this._dataSegments.push({ name, kind: 'passive', memoryVar: varIndex(0), data });
    return this;
  }

  // -------------------------------------------------------------------------
  // Tables
  // -------------------------------------------------------------------------

  /**
   * Adds a table definition.
   *
   * @param name - Internal table name.
   * @param type - Element reference type (default `funcref`).
   * @param initial - Initial element count.
   * @param max - Maximum element count, or `null` for unbounded.
   */
  addTable(
    name: string,
    elemType: ValueType = ValType.FuncRef,
    initial: number | bigint | Limits = 0,
    max: number | bigint | null = null,
    init?: RegionInput,
  ): this {
    const limits = typeof initial === 'object' ? initial : limitsOf(initial, max);
    this._tables.push({
      name,
      elemType,
      limits,
      ...(init !== undefined ? { init: asRegion(init) } : {}),
    });
    return this;
  }

  /**
   * Adds an element segment that initializes a table with function references.
   *
   * @param segment - The element segment (target table, offset expression, and
   *   the ordered function names it writes into the table).
   */
  addElement(segment: ElementSegment): this {
    this._elements.push(segment);
    return this;
  }

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  /**
   * Adds a function import.
   *
   * @param internalName - Name used inside the module to call this function.
   * @param module - External module name (e.g. `"env"`).
   * @param base - External function name.
   * @param params - Parameter types.
   * @param results - Return types.
   * @param paramNames - The params' names, by index; `undefined` for an unnamed
   *   one — as {@link ModuleBuilder.addFunction} takes them.
   */
  addFunctionImport(
    internalName: string,
    module: string,
    base: string,
    params: ValueType[],
    results: ValueType[],
    paramNames?: readonly (string | undefined)[],
  ): this {
    this._imports.push({
      kind: ExternalKind.Func,
      module,
      field: base,
      // An imported function has no body; the record is the same one a defined
      // function uses, and its body is the empty region (M4). Its locals are
      // its params, as a defined function's begin with them — which is where
      // their names live (M7c3a; it was `locals: []`, the names kept apart in
      // `ExplicitNames.importParams`).
      func: {
        name: internalName,
        sig: { params, results },
        locals: params.map((type, i) => {
          const name = paramNames?.[i];
          return name === undefined ? { type } : { type, name };
        }),
        body: makeRegion([]),
      },
    });
    return this;
  }

  /**
   * Adds a global import.
   *
   * @param internalName - Name used inside the module to reference this global.
   * @param module - External module name.
   * @param base - External global name.
   * @param type - Value type of the global.
   * @param mutable - Whether the global is mutable.
   */
  addGlobalImport(
    internalName: string,
    module: string,
    base: string,
    type: ValueType,
    mutable = false,
  ): this {
    this._imports.push({
      kind: ExternalKind.Global,
      module,
      field: base,
      // No initializer: an imported global's value comes from the host (M2h).
      global: { name: internalName, type, mutable },
    });
    return this;
  }

  /**
   * Adds a table import.
   *
   * @param internalName - Name used inside the module to reference this table.
   * @param module - External module name.
   * @param base - External table name.
   * @param type - Element type (`FuncRef` or `ExternRef`).
   * @param initial - Minimum element count.
   * @param max - Maximum element count, or `null` for unbounded.
   */
  addTableImport(
    internalName: string,
    module: string,
    base: string,
    elemType: ValueType = ValType.FuncRef,
    initial: number | bigint | Limits = 0,
    max: number | bigint | null = null,
  ): this {
    const limits = typeof initial === 'object' ? initial : limitsOf(initial, max);
    this._imports.push({
      kind: ExternalKind.Table,
      module,
      field: base,
      table: { name: internalName, elemType, limits },
    });
    return this;
  }

  /**
   * Adds a memory import.
   *
   * @param internalName - Name used inside the module to reference this memory.
   * @param module - External module name.
   * @param base - External memory name.
   * @param initial - Minimum size in 64 KiB pages.
   * @param max - Maximum pages, or `null` for unbounded.
   * @param shared - Whether the memory is shared (threads proposal).
   * @param is64 - Whether the memory uses 64-bit addressing (memory64 proposal).
   */
  addMemoryImport(
    internalName: string,
    module: string,
    base: string,
    initial: number | bigint | Limits,
    max: number | bigint | null = null,
    shared = false,
    is64 = false,
  ): this {
    const limits = typeof initial === 'object'
      ? initial
      : limitsOf(initial, max, { isShared: shared, is64 });
    this._imports.push({
      kind: ExternalKind.Memory,
      module,
      field: base,
      memory: { name: internalName, limits },
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  /**
   * Adds an export that exposes an internal entity to the host.
   *
   * @param externalName - The name the host will use.
   * @param internalName - The name of the internal function / global / etc.
   * @param kind - The kind of the exported entity.
   */
  addExport(
    externalName: string,
    internalName: string,
    kind: WasmExport['kind'] = ExternalKind.Func,
  ): this {
    this._exports.push({ name: externalName, var: varFromToken(internalName), kind });
    return this;
  }

  // -------------------------------------------------------------------------
  // Feature flags
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Tags (EH proposal)
  // -------------------------------------------------------------------------

  /**
   * Adds an imported exception tag.
   *
   * Imported tags occupy the low end of the tag index space, ahead of every
   * tag defined by {@link ModuleBuilder.addTag} — the same layout functions,
   * globals and tables use. Every `throw` / `catch` / tag export resolves
   * against that combined space.
   *
   * @param internalName - Name used inside the module to reference this tag.
   * @param module - External module name.
   * @param base - External tag name.
   * @param params - The exception payload types.
   */
  addTagImport(
    internalName: string,
    module: string,
    base: string,
    params: ValueType[],
  ): this {
    this._imports.push({
      kind: ExternalKind.Tag,
      module,
      field: base,
      tag: { name: internalName, sig: { params, results: [] } },
    });
    return this;
  }

  /**
   * Adds an exception tag.
   *
   * @param name - Internal tag name (e.g. `"$MyError"`).
   * @param params - The exception payload types.
   * @param results - The type's results — empty in a valid module (M2).
   */
  addTag(name: string, params: ValueType[], results: ValueType[] = []): this {
    this._tags.push({ name, sig: { params, results } });
    return this;
  }

  /**
   * Sets the module's start function (section 8), or clears it with `null`.
   *
   * The named function runs at instantiation, before any export is callable,
   * and must take no parameters and return no results. The name is resolved at
   * write time — `writeWasm` throws (`undefined func "…"`) if it does not
   * match a defined or imported function.
   *
   * @param name - Internal function name, or `null` to remove the start function.
   */
  setStart(name: string | null): this {
    // A numeric token names an index, as every builder reference does.
    this._start = name === null ? undefined : varFromToken(name);
    return this;
  }

  /**
   * Adds a user-defined heap type (struct, array, or func) to the type section.
   * Returns the 0-based index for use in GC instructions.
   *
   * Declared types are written first, in this order; a function signature
   * that no declared type spells is appended after them when the module is
   * written (`writeWasm`), so a `{ kind: "func" }` entry is needed only to fix
   * WHICH type a function has. (Until 1.6.0 the encoder required every
   * signature declared here once any type was.)
   *
   * ```ts
   * const t = m.addType({ kind: "struct", fields: [{ type: "i8", mutable: true }] });
   * m.addFunction("read", [], [ValType.I32], body); // its type is appended
   * ```
   *
   * @param def - The struct, array, or function type to declare.
   */
  addType(def: TypeDef): number {
    const idx = this._types.length;
    this._types.push(namedTypeDef(def, idx, new Set(this._types.map((t) => t.name))));
    return idx;
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  /**
   * Produces the final {@link WasmModule}.
   * The builder may be reused after calling this method.
   */
  build(): WasmModule {
    return {
      name: '',
      functions: [...this._functions],
      globals: [...this._globals],
      memories: [...this._memories],
      tables: [...this._tables],
      elements: [...this._elements],
      dataSegments: [...this._dataSegments],
      imports: [...this._imports],
      exports: [...this._exports],
      tags: [...this._tags],
      ...(this._start !== undefined ? { start: this._start } : {}),
      types: [...this._types],
      hasDataCountSection: false,
      hasNameSection: false,
      ...noAsWrittenMetadata(),
    };
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Returns the function with the given name, or `undefined` if not found. */
  getFunction(name: string): WasmFunction | undefined {
    return this._functions.find((f) => f.name === name);
  }

  /** Returns the global with the given name, or `undefined` if not found. */
  getGlobal(name: string): WasmGlobal | undefined {
    return this._globals.find((g) => g.name === name);
  }

  /** Returns `true` if a function with the given name has been added. */
  hasFunction(name: string): boolean {
    return this._functions.some((f) => f.name === name);
  }

  /** Returns the number of functions currently defined. */
  get functionCount(): number {
    return this._functions.length;
  }

  /** The result type of a local reference, resolving params from a function. */
  static localType(fn: WasmFunction, index: number): ValueType | undefined {
    return fn.locals[index]?.type;
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * Creates an empty module (convenience alias for `new ModuleBuilder().build()`).
   */
  static empty(): WasmModule {
    return new ModuleBuilder().build();
  }

  /**
   * Returns a new module with the `void` (`none`) return type sentinel for convenience.
   * @deprecated Prefer using `None` from `@jrmarcum/binaryang/ir/binaryen-ts` directly.
   */
  static readonly Void: Type = None;
}
