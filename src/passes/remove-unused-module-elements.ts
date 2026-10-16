/**
 * @module passes/remove-unused-module-elements
 *
 * RemoveUnusedModuleElements pass — global dead-code elimination.
 *
 * Removes function definitions and global variable definitions that are
 * provably unreachable from the module's public interface (exports and
 * element segments). Imported functions and globals are never removed
 * (they exist in the host environment regardless).
 *
 * **Reachability algorithm**:
 * 1. Seed the live set with all functions referenced by exports (kind
 *    `"function"`) and by element segments (indirect-call tables).
 * 2. Repeat until fixed point: for each live function, walk its body
 *    and add any directly called function names to the live set.
 * 3. Remove all non-imported functions not in the live set.
 * 4. Collect all global names referenced by live functions and global
 *    initialisers; remove non-imported globals not in that set.
 * 5. Remove exports that refer to removed functions or globals.
 *
 * **Tables only this module can see** (open-work 30, step 3; upstream's
 * "referenced but not used"): a function that sits in an active element
 * segment of a table that is neither imported nor exported, and that no
 * instruction reads or changes (`table.get / set / grow / fill / copy / init`),
 * can only ever be called by a `call_indirect` on that table with ITS
 * signature (the engine checks it). If no live code makes such a call, the
 * function keeps its slot — the segment and every other index stay as they
 * are — but its body becomes `unreachable`, and what only it called or read
 * goes. Zig fills its vtables this way: `Io.Writer.unimplementedSendFile`,
 * `heap.BrkAllocator.remap`. Not when any type declares a supertype (a
 * `call_indirect` of a supertype could reach a subtype's function).
 *
 * **Limitations**: functions in the segments of any other table are kept
 * unconditionally (they are potential indirect-call targets). Dynamic
 * global access patterns introduced by host imports are assumed to be
 * visible and are not analysed.
 *
 * Reference: `WebAssembly/binaryen/src/passes/RemoveUnusedModuleElements.cpp`
 *
 * @license MIT
 */

import { type Expression, ExpressionKind, makeRegion, makeUnreachable } from '../ir/expressions.ts';
import { elemFuncNames, type WasmModule } from '../ir/module.ts';
import type { FuncSignature, Var } from '../ir/ir.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';
import { walkExpression } from '../ir/walk.ts';
import { requireName } from '../ir/ir.ts';
import { ExternalKind } from '../core/binary.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Removes unreachable functions and globals from the module. */
export class RemoveUnusedModuleElementsPass implements Pass {
  readonly name = 'RemoveUnusedModuleElements';
  readonly description =
    'Removes functions and globals not reachable from exports or element segments.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    _removeUnused(module);
  }
}

registerPass(RemoveUnusedModuleElementsPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function _removeUnused(module: WasmModule): void {
  // Imported FUNCTIONS need no set of their own. Only definitions are ever
  // pruned (`module.functions`), and the walk looks a name up among
  // definitions, so an imported callee is simply not found and not walked.
  // An `importedFuncs` set used to guard both; an M4 mutant emptying it
  // changed nothing (EQUIVALENT), and it was deleted in the scheduled cleanup,
  // measured to move no optimizer output. Its one other use kept a DEFINITION
  // that shared an import's name — in no well-formed module: function names are
  // unique across the index space (the decoder names by index and renames a
  // duplicate from a name section; WAT rejects a duplicate `$name`). Over the
  // corpora the only such module was the spec's `func.74`, an
  // `assert_malformed` "duplicate func".
  const importedGlobals = new Set<string>(
    module.imports
      .filter((imp) => imp.kind === ExternalKind.Global)
      .map((imp) => imp.global.name),
  );

  // Index local function definitions for quick lookup
  const funcMap = new Map(module.functions.map((f) => [f.name, f]));

  // --- Step 1: seed with exported functions ---
  const liveFuncs = new Set<string>();

  for (const exp of module.exports) {
    if (exp.kind === ExternalKind.Func) liveFuncs.add(requireName(exp.var, 'export'));
  }

  // Functions referenced in element segments (indirect-call targets): live,
  // unless the table is one only this module can see — then only a matching
  // `call_indirect` makes them live (step 2, `reachIndirect`).
  const tableName = _tableNames(module);
  const closed = _closedTables(module);
  const closedTableFuncs = new Map<string, string[]>();
  const tableOnly = new Set<string>();
  for (const seg of module.elements) {
    const table = seg.kind === 'active' ? tableName(seg.tableVar) : '';
    for (const name of elemFuncNames(seg)) {
      if (closed.has(table)) {
        closedTableFuncs.set(table, [...(closedTableFuncs.get(table) ?? []), name]);
        tableOnly.add(name);
      } else liveFuncs.add(name);
    }
  }
  for (const name of liveFuncs) tableOnly.delete(name);

  // The start function runs at instantiation, so it is a reachability root
  // exactly like an export. Without this seed a start function that nothing
  // else references is pruned here, and the encoder then fails to resolve
  // `mod.start` — or, worse, the module instantiates without ever running it.
  if (module.start !== undefined) liveFuncs.add(requireName(module.start, 'start'));

  // --- Step 2: fixed-point reachability walk ---
  const queue = [...liveFuncs];
  // A `call_indirect` on a closed table reaches the functions there of its
  // signature, whatever slot it names.
  const seenIndirect = new Set<string>();
  const reachIndirect = (tableVar: Var, sig: FuncSignature): void => {
    const table = tableName(tableVar);
    const key = `${table}\u0000${_sigKey(sig)}`;
    if (seenIndirect.has(key)) return;
    seenIndirect.add(key);
    for (const name of closedTableFuncs.get(table) ?? []) {
      const fn = funcMap.get(name);
      // An imported function in the table: always kept, nothing to empty.
      if (fn !== undefined && _sigKey(fn.sig) !== _sigKey(sig)) continue;
      if (liveFuncs.has(name)) continue;
      liveFuncs.add(name);
      queue.push(name);
    }
  };
  // A `ref.func` in a global's or a table's initializer is a root too: the
  // value exists from instantiation, and what reads it is not ours to see.
  for (const g of module.globals) {
    if (g.init) _collectCallTargets(g.init, liveFuncs, queue, reachIndirect);
  }
  for (const t of module.tables) {
    if (t.init) _collectCallTargets(t.init, liveFuncs, queue, reachIndirect);
  }
  while (queue.length > 0) {
    const name = queue.pop()!;
    const fn = funcMap.get(name);
    if (!fn) continue; // imported or unknown
    _collectCallTargets(fn.body, liveFuncs, queue, reachIndirect);
  }
  // A function only a closed table holds, that no call can reach: its slot
  // stays (so every index means what it did), its body traps, and what only
  // it called or read is no longer kept for it.
  for (const name of tableOnly) {
    const fn = funcMap.get(name);
    if (fn === undefined || liveFuncs.has(name)) continue;
    fn.body = makeRegion([makeUnreachable()]);
    // `locals` is every local, the parameters first: the parameters stay.
    fn.locals = fn.locals.slice(0, fn.sig.params.length);
  }
  const kept = new Set([...liveFuncs, ...tableOnly]);

  // --- Step 3: collect referenced globals (from live functions + global inits) ---
  const liveGlobals = new Set<string>();

  // Globals referenced by live functions
  for (const [name, fn] of funcMap) {
    if (liveFuncs.has(name)) _collectGlobalRefs(fn.body, liveGlobals);
  }

  // Globals referenced by other global initialisers (globals can depend on each other)
  for (const global of module.globals) {
    if (importedGlobals.has(global.name) || global.init === undefined) continue;
    _collectGlobalRefs(global.init, liveGlobals);
  }

  // Globals read by the module's other constant expressions. 🔧 Missing: an
  // element segment at `(global.get $g2)` kept its offset while `$g2` was
  // removed, and the encoder refused the module ("unresolved global.get
  // reference") — `spec/global/global.50.wasm`, every level, both routes.
  for (const seg of module.elements) {
    if (seg.offset) _collectGlobalRefs(seg.offset, liveGlobals);
    for (const item of seg.elemExprs) _collectGlobalRefs(item, liveGlobals);
  }
  for (const seg of module.dataSegments) {
    if (seg.offset) _collectGlobalRefs(seg.offset, liveGlobals);
  }
  for (const t of module.tables) if (t.init) _collectGlobalRefs(t.init, liveGlobals);

  // Always keep globals that are exported
  for (const exp of module.exports) {
    if (exp.kind === ExternalKind.Global) liveGlobals.add(requireName(exp.var, 'export'));
  }

  // --- Step 4: prune non-live, non-imported definitions ---
  const removedFuncs = new Set<string>();
  module.functions = module.functions.filter((fn) => {
    if (kept.has(fn.name)) return true;
    removedFuncs.add(fn.name);
    return false;
  });

  module.globals = module.globals.filter(
    (g) => importedGlobals.has(g.name) || liveGlobals.has(g.name),
  );

  // --- Step 5: prune exports pointing to removed functions/globals ---
  module.exports = module.exports.filter((exp) => {
    if (exp.kind === ExternalKind.Func) return !removedFuncs.has(requireName(exp.var, 'export'));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _collectCallTargets(
  expr: Expression,
  live: Set<string>,
  queue: string[],
  reachIndirect: (table: Var, sig: FuncSignature) => void,
): void {
  // A newly live name is queued; the queue skips one with no definition (an
  // import), so imports need no check here.
  const reach = (target: string): void => {
    if (live.has(target)) return;
    live.add(target);
    queue.push(target);
  };
  walkExpression(expr, (e) => {
    // The liveness sets are keyed by NAME, so the reference is read as one.
    // This pass runs before any index resolution; an index-form target here
    // would mean the module was built by a path that skipped naming, which
    // requireName says rather than silently missing the entity.
    if (e.kind === ExpressionKind.Call) reach(requireName(e.func, 'call target'));
    if (e.kind === ExpressionKind.RefFunc) reach(requireName(e.func, 'ref.func'));
    if (e.kind === ExpressionKind.CallIndirect) {
      reachIndirect(e.table, e.sig);
    }
  });
}

/**
 * A table reference, by name or by INDEX (instructions may hold either; imported
 * tables first in the index space), as the table's name. An index past the end
 * gives a key no table has, so whatever it names counts as visible.
 */
function _tableNames(module: WasmModule): (v: Var) => string {
  const all = [
    ...module.imports.flatMap((i) => (i.kind === ExternalKind.Table ? [i.table.name] : [])),
    ...module.tables.map((t) => t.name),
  ];
  return (v) => (v.kind === 'name' ? v.name : all[v.value] ?? `\u0000#${v.value}`);
}

/** A signature as a string: equal strings for structurally equal signatures. */
const _sigKey = (s: FuncSignature): string =>
  JSON.stringify(s, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));

/**
 * The tables only this module can see and that hold their initial contents:
 * defined here, not exported, and no instruction or constant expression reads
 * or changes them. Empty when any type declares a supertype.
 */
function _closedTables(module: WasmModule): Set<string> {
  if (module.types.some((t) => (t.sub?.supertypes.length ?? 0) > 0)) return new Set();
  const tableName = _tableNames(module);
  const closed = new Set(module.tables.map((t) => t.name));
  // Defence only: an imported table is an import, not in `module.tables`, so
  // this changes nothing today (its mutant is equivalent, 2026-10-15). It keeps
  // the rule true if the two lists are ever joined.
  for (const imp of module.imports) {
    if (imp.kind === ExternalKind.Table) closed.delete(imp.table.name);
  }
  for (const exp of module.exports) {
    if (exp.kind === ExternalKind.Table) closed.delete(tableName(exp.var));
  }
  const touched = (e: Expression): void => {
    walkExpression(e, (x) => {
      switch (x.kind) {
        case ExpressionKind.TableGet:
        case ExpressionKind.TableSet:
        case ExpressionKind.TableGrow:
        case ExpressionKind.TableFill:
        case ExpressionKind.TableInit:
          closed.delete(tableName(x.table));
          break;
        case ExpressionKind.TableCopy:
          closed.delete(tableName(x.destTable));
          closed.delete(tableName(x.sourceTable));
          break;
      }
    });
  };
  for (const fn of module.functions) touched(fn.body);
  for (const g of module.globals) if (g.init) touched(g.init);
  return closed;
}

function _collectGlobalRefs(expr: Expression, liveGlobals: Set<string>): void {
  walkExpression(expr, (e) => {
    if (e.kind === ExpressionKind.GlobalGet) liveGlobals.add(requireName(e.var, 'global.get'));
    if (e.kind === ExpressionKind.GlobalSet) liveGlobals.add(requireName(e.var, 'global.set'));
  });
}
