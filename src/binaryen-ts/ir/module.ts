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

import { asRegion, type RegionExpr, type RegionInput } from './expressions.ts';
import { None, type Type, ValType } from './types.ts';
import type { ValueType } from './gc-types.ts';
import type { TypeDef } from './gc-types.ts';
import { type FuncSignature, type Var, varFromToken } from '../../wabt-ts/ir/ir.ts';
import { type BinarySection, ExternalKind } from '../../wabt-ts/core/binary.ts';
export type { TypeDef } from './gc-types.ts';

// ---------------------------------------------------------------------------
// Module-level definition types
// ---------------------------------------------------------------------------

/**
 * A single local variable declaration inside a function.
 * Params are also represented as locals (indices 0..params.length-1).
 */
export interface Local {
  /** Type of the local — a scalar/abstract type or a concrete typed reference. */
  type: ValueType;
  /** Optional name (for WAT output readability). */
  name?: string;
}

/**
 * A WASM function definition.
 * Mirrors `Function` in `WebAssembly/binaryen/src/wasm.h`.
 */
export interface WasmFunction {
  /** Internal name (used for calls and exports). */
  name: string;
  /** Parameter types (subset of locals at indices 0..params.length-1). */
  params: ValueType[];
  /** Result types (empty = void). */
  results: ValueType[];
  /** All locals including params. Additional locals start at params.length. */
  locals: Local[];
  /** The function's region — see {@link RegionExpr}. */
  body: RegionExpr;
  /**
   * Label of the function's implicit outermost block — the target of a `br`
   * that exits the whole function (depth = number of enclosing blocks). The
   * binary parser records the frame's label here; the encoder seeds it at the
   * bottom of its label stack so such a branch resolves to the correct depth
   * instead of silently collapsing to the innermost frame. Optional.
   */
  bodyFrameLabel?: string | undefined;
}

/**
 * Import descriptor.
 * Mirrors `Import` in `WebAssembly/binaryen/src/wasm.h`.
 */
export interface WasmImport {
  /** Internal module name (`"env"`, `"wasi_snapshot_preview1"`, etc.). */
  module: string;
  /** The base name within that module. */
  base: string;
  /** Internal name used to reference this import within the module. */
  name: string;
  /** Which kind of entity is being imported. */
  kind: 'function' | 'global' | 'table' | 'memory' | 'tag';
  /** For function imports: parameter types. For tag imports: the tag's payload types. */
  params?: ValueType[];
  /** For function imports: result types. */
  results?: ValueType[];
  /** For global imports: value type. For table imports: element type. */
  type?: ValueType;
  /** For global imports: whether the global is mutable. */
  mutable?: boolean;
  /** For table/memory imports: minimum size (elements or pages). */
  initial?: number;
  /** For table/memory imports: maximum size, or null for unbounded. */
  max?: number | null;
  /** For memory imports: whether the memory is shared (threads proposal). */
  shared?: boolean;
  /** For memory imports: whether the memory uses 64-bit addressing. */
  is64?: boolean;
}

/**
 * Export descriptor.
 * Mirrors `Export` in `WebAssembly/binaryen/src/wasm.h`.
 */
export interface WasmExport {
  /** The name visible to the host. */
  name: string;
  /**
   * The exported entity — a NAME in this tree, as every reference a pass reads
   * is (`requireName`); a `Var` so an index as written can be held too (S6
   * step 5 item 6 (M2), wabt-ts's shape — the L1 / S2 precedent). It was
   * `value: string`.
   */
  var: Var;
  /**
   * Which kind of entity is exported — wabt-ts's `ExternalKind`, whose value IS
   * the binary's kind byte (S6 step 5 item 6 (M2e); the V1 precedent). It was a
   * string (`'function'`, …) spelling the same five facts a second way.
   */
  kind: ExternalKind;
}

/**
 * A WASM global variable.
 */
export interface WasmGlobal {
  /** Internal name used to reference this global from instructions. */
  name: string;
  /** Value type of the global. */
  type: ValueType;
  /** Whether the global is writable via `global.set`. */
  mutable: boolean;
  /**
   * The initializer — a constant expression, held as a {@link RegionExpr} of
   * exactly the instructions it is (owner, 2026-09-16, S6 step 5 item 6 (M2);
   * wabt-ts's shape). It was one `Expression`, which cannot hold a sequence.
   */
  init: RegionExpr;
}

/**
 * A data segment (initializes a region of linear memory).
 */
export interface DataSegment {
  /** Segment name (for WAT output). */
  name: string;
  /** `true` for passive segments (not auto-applied at instantiation). */
  passive: boolean;
  /**
   * Memory an ACTIVE segment initialises. Omitted means 0.
   *
   * The binary distinguishes kind 0 (active, memory 0) from kind 2 (active,
   * explicit memory index); the reader used to consume that index and drop it.
   */
  memory?: number;
  /**
   * The offset — a constant expression as a {@link RegionExpr}, present exactly
   * when the segment is active. ABSENT is a missing field, not `null` (M2).
   */
  offset?: RegionExpr;
  /** Raw bytes copied into linear memory. */
  data: Uint8Array;
}

/**
 * A linear memory definition.
 */
export interface WasmMemory {
  /** Internal name used to reference the memory from instructions. */
  name: string;
  /** Initial size in pages (64 KiB each). */
  initial: number;
  /** Maximum size in pages, or `null` for unbounded. */
  max: number | null;
  /** Whether this memory is shared (atomics proposal). */
  shared: boolean;
  /** Whether this memory uses 64-bit addressing (memory64 proposal). */
  is64: boolean;
}

/**
 * A table definition (for indirect calls and reference types).
 */
export interface WasmTable {
  /** Internal name used to reference the table from instructions. */
  name: string;
  /** Element value type — typically a reference type. */
  type: ValueType;
  /** Initial number of slots. */
  initial: number;
  /** Maximum number of slots, or `null` for unbounded. */
  max: number | null;
}

/**
 * A WASM exception tag (EH proposal).
 * A tag defines the type of an exception — its payload is a list of value types.
 */
export interface WasmTag {
  /** Internal name (used in `throw` and `try_table` catch clauses). */
  name: string;
  /**
   * The tag's function type: its `params` are the exception payload; its
   * `results` are empty in a valid module and kept as read for a validator to
   * refuse (S6 step 5 item 6 (M2), wabt-ts's shape). It was `params` alone,
   * which could not hold what an invalid binary said.
   */
  sig: FuncSignature;
}

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
export type ElementSegmentMode = 'active' | 'passive' | 'declarative';

export interface ElementSegment {
  /** Segment name (for WAT output). */
  name: string;
  /** How the segment reaches its table. */
  mode: ElementSegmentMode;
  /** Name of the target table that this segment initializes. */
  table: string;
  /**
   * Offset expression — index into the target table where copying begins.
   *
   * Present exactly when `mode` is `active`; the other two modes have nowhere
   * to copy to, and the field is MISSING (it was `null`). A constant expression,
   * held as a {@link RegionExpr} (M2).
   */
  offset?: RegionExpr;
  /** Names of the functions referenced by this segment, in order. */
  data: string[];
}

// ---------------------------------------------------------------------------
// Root module container
// ---------------------------------------------------------------------------

/**
 * The root container for all WASM definitions.
 * Analogous to `Module` in `WebAssembly/binaryen/src/wasm.h`.
 */
export interface WasmModule {
  /** All locally-defined functions in declaration order. */
  functions: WasmFunction[];
  /** All locally-defined globals in declaration order. */
  globals: WasmGlobal[];
  /** All linear-memory definitions (typically 0 or 1 entry pre-multi-memory). */
  memories: WasmMemory[];
  /** All table definitions in declaration order. */
  tables: WasmTable[];
  /** Element segments that initialize tables. */
  elements: ElementSegment[];
  /** Data segments that initialize linear memory. */
  dataSegments: DataSegment[];
  /** Imported entities (functions, globals, memories, tables). */
  imports: WasmImport[];
  /** Names exported to the host. */
  exports: WasmExport[];
  /** Exception tags (EH proposal). */
  tags: WasmTag[];
  /**
   * Name of the start function (section 8), or `null` if the module has none.
   *
   * The start function runs at instantiation time, before any export is
   * callable. It is a root of the module's reachability graph exactly like an
   * export, so passes that prune unreachable definitions must seed from it.
   */
  start: string | null;
  /** Whether the module uses the WASM exception-handling proposal. */
  hasExceptionHandling: boolean;
  /** Whether the module uses the memory64 proposal. */
  hasMemory64: boolean;
  /** Whether the module uses the multi-memory proposal. */
  hasMultiMemory: boolean;
  /** User-defined heap types (struct, array, func) for the GC proposal. */
  heapTypes: TypeDef[];
  /** Whether the module uses the GC proposal. */
  hasGC: boolean;
  /**
   * The names the module was READ with — its `name` section — as opposed to
   * the ones the decoder made up. N1 steps P4–P5 (cmem/names.md).
   *
   * Every entity here is keyed by a name, so the decoder names the unnamed ones
   * `$func3`, `$global0`, … The encoder must not write those into a name
   * section — that would invent names, the fault `wasm2wat`'s `generateNames`
   * had — so it writes only what is listed here. Upstream binaryen keeps the
   * same distinction as `hasExplicitName`.
   *
   * Absent means the module had no name section, and none is written: a module
   * built through the API, or by the internal `parseWat`, encodes as before.
   * `PassRunner` drops it at the end of a run unless `debugInfo` is set —
   * optimized output follows `-g`, as upstream.
   */
  explicitNames?: ExplicitNames;
  /**
   * Whether the module was decoded from a binary with a DataCount section (id
   * 12) — W6. The encoder writes one when a function body names a data segment
   * (then the format requires it), or when this is set, so a binary that
   * carried one it did not need re-encodes with it. Absent means false.
   */
  hasDataCount?: boolean;
  /**
   * The custom sections the module was decoded from, in binary order — C3
   * (cmem/divergences.md).
   *
   * 🔧 The decoder collected NONE, so a decode → encode dropped `producers`,
   * `target_features`, `dylink.0` and every DWARF section outright, with no
   * diagnostic. Upstream `wasm-opt` keeps them all, through `-O2`.
   *
   * Each one records the position it held, so the module comes back as it went
   * in — where upstream APPENDS them after the known sections and special-cases
   * only `dylink.0` (which must come first). Absent means a module built
   * through the API, which has none.
   */
  customSections?: CustomSection[];
}

/**
 * One custom section a module carried: its bytes and where they sat.
 *
 * The `name` section is the exception — the encoder GENERATES it from
 * {@link WasmModule.explicitNames}, so the entry for it only marks the PLACE,
 * with `data: null`. That is how a binary whose customs straddle the name
 * section (`.debug_*`, `name`, `producers` — clang's layout) re-encodes in the
 * order it arrived.
 */
export interface CustomSection {
  /** The section's name: `producers`, `target_features`, `dylink.0`, `.debug_info`, … */
  name: string;
  /** Its payload, verbatim — or `null` for the `name` section's place. */
  data: Uint8Array | null;
  /**
   * The known section this one FOLLOWED, or `null` when it came before every
   * known section; ABSENT when the position is not known (built by hand), and
   * then it is written last. Ids are the binary's own (1 type … 13 tag), so a
   * section is written back into the same gap even if the neighbour it was
   * recorded against is gone. wabt-ts's `Custom.precedingSection` (M2f).
   */
  precedingSection?: BinarySection | null;
}

/**
 * A module's names from its `name` section, as {@link WasmModule.explicitNames}
 * holds them. Every name is `$`-prefixed like the IR's own.
 *
 * Entities are listed by the name they carry in the IR (after disambiguation),
 * so a pass that renames or removes one simply takes it out of the name section.
 * TYPES and their fields are keyed by the `TypeDef` OBJECT: the type section is
 * written from `heapTypes`, and a pass that rebuilds a type loses its name rather
 * than lending it to whatever takes its index.
 */
export interface ExplicitNames {
  /** The module's own name (subsection 0). */
  module?: string;
  /** Functions, imported and defined (1). */
  functions: ReadonlySet<string>;
  /** Param names of IMPORTED functions, by import name (2) — a defined function's are `Local.name`. */
  importParams: ReadonlyMap<string, ReadonlyMap<number, string>>;
  /**
   * Which functions the local subsection (2) LISTED, by IR name — or `null`
   * when the section had no local subsection at all. N6.
   *
   * 🔧 The encoder listed every function, upstream `wat2wasm --debug-names`'s
   * shape; a producer lists only the ones that HAVE a named local, so
   * re-encoding a clang or rustc binary gained entries it never had. Keyed by
   * name, like every other entry here: a function a pass removed simply leaves
   * the section, and one a pass added was never in it.
   */
  localsListed: ReadonlySet<string> | null;
  /** Label names, by function name (3) — the names of the blocks, loops, ifs and trys that had one. */
  labels: ReadonlyMap<string, ReadonlySet<string>>;
  /** Type names (4). */
  types: ReadonlyMap<TypeDef, string>;
  /** Tables (5), memories (6), globals (7), element (8) and data (9) segments, tags (11). */
  tables: ReadonlySet<string>;
  memories: ReadonlySet<string>;
  globals: ReadonlySet<string>;
  elements: ReadonlySet<string>;
  dataSegments: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  /** Struct field names, by type (10). */
  fields: ReadonlyMap<TypeDef, ReadonlyMap<number, string>>;
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
  private _start: string | null = null;
  private _hasEH = false;
  private _hasMemory64 = false;
  private _hasMultiMemory = false;
  private _hasGC = false;
  private readonly _heapTypes: TypeDef[] = [];

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
      params,
      results,
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
    initial: number,
    max: number | null = null,
    shared = false,
    is64 = false,
  ): this {
    this._memories.push({ name, initial, max, shared, is64 });
    if (is64) this._hasMemory64 = true;
    return this;
  }

  /**
   * Adds an active data segment that initializes a region of linear memory.
   *
   * @param name - Segment name.
   * @param offset - Constant offset expression (e.g. `makeI32Const(0)`).
   * @param data - Raw bytes.
   */
  addDataSegment(name: string, offset: RegionInput, data: Uint8Array, memory = 0): this {
    this._dataSegments.push({
      name,
      passive: false,
      offset: asRegion(offset),
      data,
      ...(memory !== 0 ? { memory } : {}),
    });
    return this;
  }

  /**
   * Adds a passive data segment (not auto-applied; used with `memory.init`).
   */
  addPassiveDataSegment(name: string, data: Uint8Array): this {
    this._dataSegments.push({ name, passive: true, data });
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
    type: ValueType = ValType.FuncRef,
    initial = 0,
    max: number | null = null,
  ): this {
    this._tables.push({ name, type, initial, max });
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
   */
  addFunctionImport(
    internalName: string,
    module: string,
    base: string,
    params: ValueType[],
    results: ValueType[],
  ): this {
    this._imports.push({ kind: 'function', name: internalName, module, base, params, results });
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
    this._imports.push({ kind: 'global', name: internalName, module, base, type, mutable });
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
    type: ValueType = ValType.FuncRef,
    initial = 0,
    max: number | null = null,
  ): this {
    this._imports.push({ kind: 'table', name: internalName, module, base, type, initial, max });
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
    initial: number,
    max: number | null = null,
    shared = false,
    is64 = false,
  ): this {
    this._imports.push({
      kind: 'memory',
      name: internalName,
      module,
      base,
      initial,
      max,
      shared,
      is64,
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
    this._imports.push({ kind: 'tag', name: internalName, module, base, params });
    this._hasEH = true;
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
    this._hasEH = true;
    return this;
  }

  /**
   * Sets the module's start function (section 8), or clears it with `null`.
   *
   * The named function runs at instantiation, before any export is callable,
   * and must take no parameters and return no results. The name is resolved at
   * encode time — `encodeWasm` throws if it does not match a defined or
   * imported function.
   *
   * @param name - Internal function name, or `null` to remove the start function.
   */
  setStart(name: string | null): this {
    this._start = name;
    return this;
  }

  /** Enables the exception-handling proposal. */
  enableExceptionHandling(): this {
    this._hasEH = true;
    return this;
  }

  /**
   * Adds a user-defined heap type (struct, array, or func) to the type section.
   * Returns the 0-based index for use in GC instructions.
   *
   * Calling this enables the GC proposal, which changes how the encoder emits
   * the type section: it stops deduplicating function signatures collected from
   * the module and emits `heapTypes` verbatim instead. **Every function's own
   * signature must therefore be declared here as a `{ kind: "func" }` entry**,
   * or `encodeWasm` throws `unresolved GC function type: () -> (i32)`.
   * `addFunction` alone is enough without GC and not enough with it:
   *
   * ```ts
   * const t = m.addHeapType({ kind: "struct", fields: [{ type: "i8", mutable: true }] });
   * m.addHeapType({ kind: "func", params: [], results: [ValType.I32] }); // required
   * m.addFunction("read", [], [ValType.I32], body);
   * ```
   *
   * @param def - The struct, array, or function type to declare.
   */
  addHeapType(def: TypeDef): number {
    const idx = this._heapTypes.length;
    this._heapTypes.push(def);
    this._hasGC = true;
    return idx;
  }

  /**
   * Enables the GC proposal.
   *
   * Note that this also puts the encoder into GC type-section mode, where each
   * function's signature must be declared explicitly via
   * {@link ModuleBuilder.addHeapType} — see that method for details.
   */
  enableGC(): this {
    this._hasGC = true;
    return this;
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
      functions: [...this._functions],
      globals: [...this._globals],
      memories: [...this._memories],
      tables: [...this._tables],
      elements: [...this._elements],
      dataSegments: [...this._dataSegments],
      imports: [...this._imports],
      exports: [...this._exports],
      tags: [...this._tags],
      start: this._start,
      heapTypes: [...this._heapTypes],
      hasExceptionHandling: this._hasEH,
      hasMemory64: this._hasMemory64,
      hasMultiMemory: this._hasMultiMemory,
      hasGC: this._hasGC,
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
