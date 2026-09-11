// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The route by which EXTERNAL WAT reaches binaryen-ts:
 *
 * ```
 * WAT → wabt-ts parser → wabt-ts binary writer → bytes → binaryen-ts binary decoder
 * ```
 *
 * Owner decision, 2026-09-10 (divergence W4): this is the pipeline binaryang
 * converges on anyway — one text front end, one decoder — so external text
 * takes it now rather than going through binaryen-ts's own WAT parser.
 *
 * Why it reads what that parser cannot. binaryen-ts's parser implements a
 * folded subset: it cannot take several operands from the stack (`(i32.add)`,
 * `(select)`), an `if` / `br_if` condition from the stack, block parameters,
 * or bare linear form. wabt-ts's parser reads the whole text format — byte for
 * byte with upstream wat2wasm on every parenthesised form probed — and by the
 * time binaryen-ts sees the module it is BYTES, which its decoder already
 * reconstructs by simulating the operand stack exactly.
 *
 * 🔧 Supersedes `parseWatAnyForm` (C10, `ab90d7beb`), which tried the folded
 * parser first and fell back to wabt-ts + the BRIDGE. The bridge mistranslates
 * 20 of the 421 corpus modules (C10a) and is deleted in S6 step 5; bytes need
 * no translation. Nothing called it any more.
 *
 * What does not survive the hop: WAT NAMES. The decoder skips the name
 * section, so `$foo` comes back as a generated name. Irrelevant to binary
 * output; visible only if the module is printed back as text.
 */

import { wat2wasm } from '../../wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../wabt-ts/core/error.ts';
import { parseWasm } from '../binary/wasm-parser.ts';
import type { WasmModule } from '../ir/module.ts';

/** WAT the text front end could not read; `message` carries its diagnostics, with positions. */
export class WatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatInputError';
  }
}

/**
 * External WAT, in any form — folded, linear or mixed — as binaryen-ts IR.
 *
 * @throws {WatInputError} with wabt-ts's diagnostics when the text is not a
 *   module it can assemble.
 */
export function readWat(source: string, filename = '<input>'): WasmModule {
  const { binary, errors } = wat2wasm(source, { filename });
  if (hasErrors(errors)) throw new WatInputError(formatErrors(errors));
  return parseWasm(binary, filename);
}
