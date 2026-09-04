// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Parse ANY form of WAT into a binaryen-ts {@link WasmModule}.
 *
 * `binaryen-ts`'s own `parseWat` reads the FOLDED subset. That was the whole
 * text format it ever saw, because our writer only emitted folded input to it —
 * but `wasm2wat --linear` is a supported, documented option, so binaryang could
 * emit a text form binaryang could not read. That asymmetry is the same one
 * that justified making folded output the default in 1.5.4, pointed the other
 * way.
 *
 * ⚠️ **This lives in `src/bridge/`, not in the parser, on purpose.**
 * `binaryen-ts` is self-contained — it imports nothing from `wabt-ts` — and the
 * bridge is the one place that is allowed to know about both. Putting a
 * `wabt-ts` fallback inside `parseWat` would have made every consumer of the
 * binaryen-ts parser depend on the whole wabt-ts front end.
 *
 * ## Why routing rather than a second parser
 *
 * The alternative was teaching `parseWat` to read bare linear form directly:
 * a flat instruction stream needs an instruction ARITY table (to know how many
 * values each opcode takes off the stack), an IMMEDIATE table, and a structural
 * pass to rebuild nesting from `end` markers. Measured against the corpus, that
 * is 123 distinct instruction names — and all of it already exists, correct and
 * tested, in wabt-ts's parser. A second implementation would be the "one fact in
 * two places" shape this codebase keeps getting bitten by, at the scale of an
 * entire instruction set.
 *
 * ⚠️ **The two routes normalise differently.** Both produce a valid module with
 * the same behaviour, but not the same bytes: on the corpus the native route is
 * byte-identical to wabt-ts on 421/421 and the bridge route on 307/421. So the
 * native parser is tried FIRST and the bridge is a fallback, rather than the
 * bridge simply handling everything.
 */

import { parseWatModule } from '../wabt-ts/parser/wast-parser.ts';
import { bridgeToBinaryen } from './bridge.ts';
import { parseWat } from '../binaryen-ts/parser/wat-parser.ts';
import type { WasmModule } from '../binaryen-ts/ir/module.ts';

/** Thrown when neither route can read the source; carries both diagnostics. */
export class WatParseFailure extends Error {
  constructor(
    message: string,
    /** Why binaryen-ts's own folded parser declined. */
    readonly foldedError: Error,
    /** Why the wabt-ts + bridge route declined, if it was reached. */
    readonly linearError?: Error | undefined,
  ) {
    super(message);
    this.name = 'WatParseFailure';
  }
}

/**
 * Parse WAT in any form — folded, linear, or mixed — into binaryen-ts IR.
 *
 * The folded parser is tried first because its output matches wabt-ts's bytes
 * exactly; the wabt-ts + bridge route is the fallback for anything it declines.
 *
 * @param source WAT text.
 * @param filename Shown in diagnostics.
 * @throws {WatParseFailure} when neither route can read `source`.
 */
export function parseWatAnyForm(source: string, filename = '<input>'): WasmModule {
  try {
    return parseWat(source, filename);
  } catch (foldedError) {
    // Fall through to the wabt-ts front end, which reads the whole text format.
    let linearError: Error | undefined;
    try {
      const { module, errors } = parseWatModule(source);
      if (errors.length === 0) return bridgeToBinaryen(module);
      linearError = new Error(errors.map((e) => e.message).join('; '));
    } catch (e) {
      linearError = e as Error;
    }
    // ⚠️ Report BOTH failures. Reporting only the second would hide the folded
    // parser's diagnostic, which is the more precise one for folded input that
    // is merely malformed — the common case — while reporting only the first
    // would claim linear input is unsupported when it is simply wrong.
    throw new WatParseFailure(
      `could not parse ${filename} as folded or linear WAT.\n` +
        `  folded: ${(foldedError as Error).message}\n` +
        `  linear: ${linearError?.message ?? '(not reached)'}`,
      foldedError as Error,
      linearError,
    );
  }
}
