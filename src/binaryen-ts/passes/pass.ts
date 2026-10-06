/**
 * @module binaryen-ts/passes/pass
 *
 * Pass infrastructure for the binaryen-ts optimizer.
 *
 * Optimization passes implement the {@link Pass} interface and are registered
 * with the {@link PassRunner} which schedules and applies them to a
 * {@link WasmModule}. This mirrors the pass infrastructure in the upstream
 * Binaryen C++ library (`WebAssembly/binaryen/src/pass.h`).
 *
 * **Hybrid note**: Individual passes may be implemented as:
 * - Pure TypeScript (run directly in Deno)
 * - TypeScript compiled to WASM via `wasic` (performance-critical paths)
 * - Delegated to the upstream `binaryen.js` WASM binary
 *
 * @example
 * ```ts
 * import { PassRunner } from "@jrmarcum/binaryang/passes";
 *
 * const runner = new PassRunner(module);
 * runner.add("DCE").add("InliningOptimizing").run();
 * ```
 *
 * @license MIT
 */

import type { WasmModule } from '../ir/module.ts';
import { dropWrittenTypeIndex, type Expression, ExpressionKind } from '../ir/expressions.ts';
import { mapExpression, stripCodeMetadata } from '../ir/walk.ts';
import { lowerBlockParams } from './lower-block-params.ts';
import { spillStackValues } from './spill-stack-values.ts';
import { handleNonDefaultableLocals } from './non-nullable-locals.ts';
import { CUSTOM_SECTION_NAME_CODE_METADATA } from '../../wabt-ts/core/binary.ts';
import { FidelityTable } from '../../wabt-ts/ir/fidelity.ts';
import { recGroups, requireIndex } from '../../wabt-ts/ir/ir.ts';

/**
 * Whether a node's written type index is only FORM (7c) — droppable because the
 * index the encoder derives names the SAME type.
 *
 * 🔧 For a `call_indirect` it is not always form. The encoder derives the FIRST
 * function type with the same params and results, and with GC types two such
 * types can be DIFFERENT types: `(rec (type $f1 (func)) (type (struct)))` and
 * `(rec (type (struct)) (type $f2 (func)))` are distinct, and a `call_indirect
 * (type $f2)` to an `$f1` function TRAPS. Dropping the index made it name `$f1`,
 * and the trap was gone (`spec/type-rec`, `spec/type-subtyping`, every level,
 * both routes). So the index goes only when both types stand alone in their rec
 * group and declare the same `sub` — which every type does in a module without
 * GC types, so nothing changes there.
 */
function writtenIndexIsForm(module: WasmModule): (e: Expression) => boolean {
  const types = module.types;
  const groupSize = new Map<number, number>();
  for (const g of recGroups(types)) {
    for (let i = g.start; i < g.start + Math.max(g.count, 1); i++) groupSize.set(i, g.count);
  }
  const alone = (i: number) => (groupSize.get(i) ?? 1) <= 1;
  const subOf = (i: number) => JSON.stringify(types[i]?.sub ?? null);
  return (e) => {
    if (e.kind !== ExpressionKind.CallIndirect || e.typeVar === undefined) return true;
    const written = requireIndex(e.typeVar, 'call_indirect type');
    const key = JSON.stringify([e.sig.params, e.sig.results]);
    const derived = types.findIndex((t) =>
      t.kind === 'func' && JSON.stringify([t.sig.params, t.sig.results]) === key
    );
    if (derived === written) return true;
    return derived >= 0 && alone(written) && alone(derived) && subOf(written) === subOf(derived);
  };
}

// ---------------------------------------------------------------------------
// Pass interface
// ---------------------------------------------------------------------------

/**
 * A single optimization pass that transforms a {@link WasmModule} in place.
 *
 * Each pass focuses on one transformation concern (dead code elimination,
 * inlining, constant folding, etc.). Passes may be chained and the order
 * matters — see {@link PassRunner} for scheduling.
 */
export interface Pass {
  /** Unique identifier for this pass (used for registration and `--print-all-passes`). */
  readonly name: string;

  /** Human-readable description shown in help output. */
  readonly description: string;

  /**
   * Whether this pass requires the non-nullable local fixup pass to run after it.
   * Mirrors `requiresNonNullableLocalFixups()` in Binaryen's `pass.h`.
   */
  readonly requiresNonNullableLocalFixups: boolean;

  /**
   * Apply the pass to the module.
   * Must not retain references into `module` after returning (tree ownership rules).
   *
   * @param module - The module to transform (modified in place).
   * @param options - Runner-level options (optimization level, etc.).
   */
  run(module: WasmModule, options: PassOptions): void;
}

// ---------------------------------------------------------------------------
// Pass options
// ---------------------------------------------------------------------------

/**
 * Options forwarded to every pass during a runner cycle.
 * Mirrors `PassOptions` in `WebAssembly/binaryen/src/pass.h`.
 */
export interface PassOptions {
  /**
   * Optimization level (0 = none, 1 = `-O1`, 2 = `-O2`, 3 = `-O3`, 4 = `-O4`).
   * Higher levels may enable more aggressive transformations.
   */
  optimizeLevel: 0 | 1 | 2 | 3 | 4;

  /**
   * Code-size shrink level (0 = none, 1 = `-Os`, 2 = `-Oz`).
   * Enables size-reducing passes at the cost of some speed.
   */
  shrinkLevel: 0 | 1 | 2;

  /**
   * Whether to preserve debug names in the output.
   * When `false`, passes may strip or rename local/function names.
   */
  debugInfo: boolean;

  /**
   * Whether to generate closed world assumptions.
   * When `true`, passes may assume all callers of internal functions are visible.
   */
  closedWorld: boolean;

  /**
   * Per-pass arguments forwarded from `--pass-arg` CLI flags.
   * Keys follow the upstream convention `passname@argname`; values are strings.
   * Passes look up their own arguments by key at runtime.
   */
  passArgs: Record<string, string>;

  /**
   * Maximum number of `if` arms partial inlining (Pattern B) will split out of
   * one function. Mirrors upstream `InliningOptions::partialInliningIfs`.
   *
   * **Default: 0** (partial inlining disabled). Upstream does not enable this
   * at any optimize-level profile either — it is opt-in via the
   * `wasm-opt -pii N` CLI flag. Setting `partialInliningIfs >= 1` enables both
   * Pattern A (early-return splits, where the value of this option is not
   * consulted as long as it is non-zero) and Pattern B (up to N `if` arms
   * split out).
   *
   * Why opt-in: split inlining trades code size for speed by turning a
   * call + branch on the cold path into a single branch, but adds a new
   * outlined function per split. Worth it for hot paths; pessimization for
   * cold code.
   */
  partialInliningIfs: number;
}

/** Default pass options matching Binaryen's `-O2` preset. */
export const defaultPassOptions: PassOptions = {
  optimizeLevel: 2,
  shrinkLevel: 0,
  debugInfo: false,
  closedWorld: false,
  passArgs: {},
  partialInliningIfs: 0,
};

/** Pass options for size-optimized `-Oz` output (used by `wasic`). */
export const shrinkPassOptions: PassOptions = {
  optimizeLevel: 2,
  shrinkLevel: 2,
  debugInfo: false,
  closedWorld: false,
  passArgs: {},
  partialInliningIfs: 0,
};

// ---------------------------------------------------------------------------
// Pass registry
// ---------------------------------------------------------------------------

/**
 * Constructor signature for a {@link Pass} subclass — any zero-argument class
 * that produces a {@link Pass} instance. Used by {@link registerPass} to record
 * pass types in the global registry.
 */
export type PassCtor = new () => Pass;
const registry = new Map<string, PassCtor>();

/**
 * Registers a pass class under its `name`.
 * Throws if a pass with the same name is already registered.
 *
 * @param ctor - The pass constructor. The class must have a `name` property.
 */
export function registerPass(ctor: PassCtor): void {
  const instance = new ctor();
  if (registry.has(instance.name)) {
    throw new Error(`Pass "${instance.name}" is already registered`);
  }
  registry.set(instance.name, ctor);
}

/**
 * Returns the list of all registered pass names.
 * Equivalent to Binaryen's `--print-all-passes` output.
 */
export function listPasses(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Creates a pass instance by name.
 *
 * Lookup is exact first, then case-insensitive — so the upstream-style CLI flags
 * (`--asyncify`, `--flatten`, `--dce`) resolve to the registry's canonical
 * PascalCase names (`Asyncify`, `Flatten`, `DCE`). No two registered passes
 * differ only by case, so the fallback is unambiguous.
 *
 * Throws if the name is unknown.
 */
export function createPass(name: string): Pass {
  let ctor = registry.get(name);
  if (!ctor) {
    // Registry names are PascalCase (`CoalesceLocals`); upstream binaryen — which
    // `compat/binaryen` emulates — names the same passes in kebab-case
    // (`coalesce-locals`). A caller following binaryen's own documentation writes
    // the kebab form, so normalise separators as well as case. Reported by wasmtk
    // 2026-08-27, who could not bisect a miscompile because every pass name they
    // tried was rejected.
    const norm = (n: string): string => n.toLowerCase().replace(/[-_]/g, '');
    const want = norm(name);
    for (const [key, value] of registry) {
      if (norm(key) === want) {
        ctor = value;
        break;
      }
    }
  }
  if (!ctor) {
    throw new Error(
      `Unknown pass: "${name}". Registered passes: ${listPasses().join(', ')}.`,
    );
  }
  return new ctor();
}

// ---------------------------------------------------------------------------
// PassRunner
// ---------------------------------------------------------------------------

/**
 * Schedules and applies a sequence of passes to a module.
 *
 * Passes are applied in the order they are added.
 * After each pass, if {@link Pass.requiresNonNullableLocalFixups} is `true`,
 * the non-nullable local fixup runs over every function
 * (`handleNonDefaultableLocals`, `non-nullable-locals.ts`). 🔧 Until 2026-09-14
 * this sentence was the only place the fixup existed: every pass declared
 * `false`, nothing read the flag, and Flatten left modules V8 refused.
 *
 * @example
 * ```ts
 * const runner = new PassRunner(module, { optimizeLevel: 3, shrinkLevel: 0 });
 * runner.addDefaultOptimizationPasses();
 * runner.run();
 * ```
 */
export class PassRunner {
  private readonly _module: WasmModule;
  private readonly _options: PassOptions;
  private readonly _queue: Pass[] = [];

  /**
   * Creates a runner bound to a specific module.
   *
   * @param module - The module to optimize. The runner mutates this module
   *   in place — clone it first if you need to keep the original.
   * @param options - Runner options merged on top of {@link defaultPassOptions}.
   */
  constructor(module: WasmModule, options: Partial<PassOptions> = {}) {
    this._module = module;
    this._options = { ...defaultPassOptions, ...options };
  }

  /**
   * Enqueues a pass by name.
   *
   * @param name - The registered pass name.
   * @returns `this` for chaining.
   */
  add(name: string): this {
    this._queue.push(createPass(name));
    return this;
  }

  /**
   * Enqueues a pass instance directly (useful for unregistered or custom passes).
   *
   * @returns `this` for chaining.
   */
  addPass(pass: Pass): this {
    this._queue.push(pass);
    return this;
  }

  /**
   * Adds the standard optimization passes for the configured {@link PassOptions.optimizeLevel}.
   * Mirrors `PassRunner::addDefaultOptimizationPasses` in Binaryen.
   *
   * @returns `this` for chaining.
   */
  addDefaultOptimizationPasses(): this {
    const passes = getDefaultOptimizationPasses(this._options);
    for (const name of passes) {
      this._queue.push(createPass(name));
    }
    return this;
  }

  /**
   * Runs all enqueued passes in order, then clears the queue.
   */
  run(): void {
    // Block parameters exist only for fidelity; no pass here was written for
    // them (S6 decision 7b(i)). Lower them before the first pass sees the tree
    // — and before the spill below: the lowering leaves each entry value where
    // the stack had it, read from its local at the start of the region, and a
    // later `pop` takes it; the spill is what makes that connection explicit.
    lowerBlockParams(this._module);
    const optimized = this._queue.length > 0;
    // A value the wabt-ts reader left on the operand stack is reachable only
    // THROUGH the stack, and a pass that introduces a block boundary between it
    // and the `pop` that takes it makes the module invalid (R11'; it did, at -O3,
    // through `Inlining`). Make every such value explicit before the first pass
    // sees the tree — only when a pass will run, so a plain read-and-write stays
    // byte-exact. binaryen-ts's decoder does the same thing while decoding, so a
    // tree that came from it has nothing here to find.
    if (optimized) spillStackValues(this._module);
    // As-written type indices are FORM (S6 decision 7c) — which of several
    // identical types a `call_indirect` named, and whether a block header was
    // written as an index. A pass may retype either, leaving the index naming
    // something else, so the form goes before the first pass runs. With no pass
    // queued this is still a plain read-and-write, which keeps it.
    if (optimized) {
      const form = writtenIndexIsForm(this._module);
      for (const fn of this._module.functions) {
        fn.body = mapExpression(fn.body, (e) => form(e) ? dropWrittenTypeIndex(e) : e);
        // Code-metadata annotations describe instructions a pass may move or
        // delete: binaryen-ts strips them in optimization runs (owner,
        // 2026-09-16). Under the same condition as the form above.
        fn.body = stripCodeMetadata(fn.body);
      }
    }
    for (const pass of this._queue) {
      pass.run(this._module, this._options);
      if (pass.requiresNonNullableLocalFixups) {
        for (const fn of this._module.functions) handleNonDefaultableLocals(fn);
      }
    }
    this._queue.length = 0;
    // Names follow `-g` once a pass has run, as upstream: there is no original
    // left to be faithful to (N1, cmem/names.md). With no pass run this is still
    // a plain read-and-write, which keeps them — the owner's rule, over
    // upstream `wasm-opt`, which strips them even then.
    if (optimized && !this._options.debugInfo) this._module.hasNameSection = false;
    // The as-written metadata describes an original the passes have replaced
    // (M8b5; `fidelity.ts`): the side table's node handles and the section
    // offsets would point at code that is not there any more.
    if (optimized) {
      this._module.fidelity = new FidelityTable();
      this._module.sectionMeta = [];
      // A name section the READER could not fully apply is kept RAW, at its
      // place, so `wasm-strip` and a plain round trip can give the bytes back
      // (R8). Once a pass has run those bytes name code that is gone: the
      // indices inside them were renumbered, removed or merged. The names the
      // module still has are in the IR and are written from there under `-g`, so
      // the raw copy is stale whether or not `-g` was asked for, and it goes.
      // 🔧 It did not, and route B's optimized output carried it: 211 of 286
      // modules that keep one, 13,720 bytes, 13,670 of them one DWARF module —
      // stale debug info, not just size. binaryen-ts's decoder never had the
      // problem because it re-generates rather than keeping bytes (R8'), so this
      // only appears on the reader route and would have shipped with stage 3
      // (One front end, found measuring stage 2 item 2, 2026-09-20).
      //
      // A raw `metadata.code.*` section is stale the same way: its entries are
      // byte offsets into function bodies the passes rewrote. Code metadata is
      // stripped in optimization runs (owner, 2026-09-16) — as annotations
      // above, and as the sections the reader keeps raw here (W8).
      this._module.customSections = this._module.customSections.filter((c) =>
        (c.name !== 'name' || c.data === null) &&
        !c.name.startsWith(CUSTOM_SECTION_NAME_CODE_METADATA)
      );
    }
  }

  /** The current pass queue (read-only). */
  get queue(): readonly Pass[] {
    return this._queue;
  }
}

// ---------------------------------------------------------------------------
// Default pass sequences
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of pass names for the standard optimization pipeline.
 * Mirrors Binaryen's default optimization pass selection logic.
 *
 * @internal
 */
function getDefaultOptimizationPasses(opts: PassOptions): string[] {
  const passes: string[] = [];

  // RemoveUnusedModuleElements where upstream schedules it: once BEFORE the
  // function passes from -O2 ("a global cleanup before anything heavy",
  // addDefaultGlobalOptimizationPrePasses) and once at the END at every level
  // (addDefaultGlobalOptimizationPostPasses). 🔧 It ran at -Os / -Oz only, so
  // -O1 / -O2 kept every dead function and -O3 removed them only through an
  // Inlining side effect (divergence I1, retired 2026-09-14: corpus -O1 / -O2
  // −39% bytes, -O3 −13%, -Os / -Oz unchanged; `dead_function_removal.test.ts`).
  if (opts.optimizeLevel >= 2) passes.push('RemoveUnusedModuleElements');

  if (opts.optimizeLevel >= 1) {
    passes.push('DCE', 'PickLoadSigns', 'Vacuum');
  }
  if (opts.optimizeLevel >= 2) {
    passes.push(
      'RemoveUnusedBrs',
      'RemoveUnusedNames',
      'OptimizeInstructions',
      'CoalesceLocals',
      'SimplifyLocals',
      'LocalCSE',
      // Again, as upstream schedules it after simplify-locals: the reads and
      // writes SimplifyLocals removed leave locals to merge and drop (open-work
      // 2, step 4a: corpus -Oz −2.9 KB; moving it here instead of running it
      // twice keeps only −2.3 KB).
      'CoalesceLocals',
    );
  }
  if (opts.optimizeLevel >= 3) {
    // SimplifyLocals after Inlining: an inlined call leaves its arguments
    // copied into locals that sinking removes (open-work 2, step 4a: corpus
    // -O3 −8.3 KB with it, −0.2 KB without).
    passes.push('Inlining', 'OptimizeInstructions', 'SimplifyLocals', 'CoalesceLocals');
  }
  if (opts.shrinkLevel >= 1) {
    passes.push('Vacuum');
  }
  if (opts.optimizeLevel >= 1) passes.push('RemoveUnusedModuleElements');
  // Last: the types nothing refers to once the module's other elements have
  // gone — which upstream's writer leaves out by construction (open-work 6).
  if (opts.optimizeLevel >= 1) passes.push('RemoveUnusedTypes');

  return passes;
}
