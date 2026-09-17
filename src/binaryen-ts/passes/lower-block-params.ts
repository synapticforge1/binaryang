// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module binaryen-ts/passes/lower-block-params
 *
 * Lowers block PARAMETERS to locals, where optimization begins (S6 decision
 * 7b(i), divergence B1).
 *
 * The decoder keeps a parametrised `block` / `loop` / `if` / `try` /
 * `try_table` as written: its entry values on the node, its body starting with
 * one `Pop` per parameter, a branch back to a parametrised loop carrying the
 * loop's parameters. That is what fidelity needs, and nothing here was written
 * for it — upstream binaryen has no block parameters (its reader lowers them),
 * and every pass in this directory is a port of one that never saw any.
 *
 * So the first thing a `PassRunner` does is lower them — and it lowers them by
 * RE-DECODING: encode the module (the encoder writes parameters exactly as
 * written) and decode it again with `lowerBlockParams`, which runs the
 * decoder's long-standing lowering — spill each entry value to a fresh local,
 * rewrite each back-edge to write the loop's locals, dispatch a `br_table`
 * mixing a parametrised loop with other targets through a trampoline. That
 * lowering is tested and it works on the operand STACK, where the parameters'
 * positions are explicit. Re-deriving them from `Pop`s already placed in a
 * tree would be a second, untested copy of it.
 *
 * Only the functions that contain parameters take the re-decoded body, and
 * only when every name the bodies can refer to still matches — the decoder
 * names entities by index, so a module renamed after decoding would get bodies
 * that name things it no longer calls that. That fails loudly rather than
 * lowering wrong.
 */

import { parseWasm } from '../binary/wasm-parser.ts';
import { encodeWasm } from '../encoder/wasm-encoder.ts';
import { blockParamsOf, type Expression } from '../ir/expressions.ts';
import { importName, type WasmModule } from '../ir/module.ts';
import { walkExpression } from '../ir/walk.ts';

/** Whether any construct in `e` keeps block parameters. */
export function hasBlockParams(e: Expression): boolean {
  let found = false;
  walkExpression(e, (n) => {
    if (!found && blockParamsOf(n) !== undefined) found = true;
  });
  return found;
}

/** The name lists a function body can refer to, by namespace, for comparison. */
function namesIn(m: WasmModule): Record<string, string[]> {
  return {
    imports: m.imports.map((i) => `${i.kind}:${importName(i)}`),
    functions: m.functions.map((f) => f.name),
    globals: m.globals.map((g) => g.name),
    memories: m.memories.map((x) => x.name),
    tables: m.tables.map((t) => t.name),
    tags: m.tags.map((t) => t.name),
    elements: m.elements.map((e) => e.name),
    dataSegments: m.dataSegments.map((d) => d.name),
  };
}

/**
 * Lowers every block parameter in `module` to locals, in place. Returns how
 * many functions were rewritten — 0, with the module untouched, when none keep
 * parameters.
 *
 * @throws Error when the module's names no longer match what decoding its own
 *   bytes would assign — see the module doc.
 */
export function lowerBlockParams(module: WasmModule): number {
  const targets = module.functions.flatMap((f, i) => (hasBlockParams(f.body) ? [i] : []));
  if (targets.length === 0) return 0;

  const lowered = parseWasm(encodeWasm(module), undefined, { lowerBlockParams: true });
  const have = namesIn(module), got = namesIn(lowered);
  for (const space of Object.keys(have)) {
    if (JSON.stringify(have[space]) !== JSON.stringify(got[space])) {
      throw new Error(
        `cannot lower block parameters: the module's ${space} names no longer match its ` +
          `own bytes (was it renamed after decoding?). Lower first — ` +
          `parseWasm(bytes, undefined, { lowerBlockParams: true }) — then rename.`,
      );
    }
  }
  for (const i of targets) {
    const f = module.functions[i]!, g = lowered.functions[i]!;
    f.body = g.body;
    f.locals = g.locals;
    f.bodyFrameLabel = g.bodyFrameLabel;
  }
  return targets.length;
}
