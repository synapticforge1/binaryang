/**
 * @module binaryen-ts
 *
 * `binaryen-ts` — A TypeScript / WebAssembly port of the Binaryen compiler
 * infrastructure, designed for use with Deno and the
 * [wasmtk](https://jsr.io/@jrmarcum/wasmtk) ecosystem.
 *
 * ## What is binaryen-ts?
 *
 * [Binaryen](https://github.com/WebAssembly/binaryen) is the WebAssembly
 * compiler infrastructure behind `wasm-opt`, Emscripten, and `wasmtk`. This
 * project is a TypeScript rewrite and ergonomic wrapper that:
 *
 * - Provides a **TypeScript-native IR** (intermediate representation) for
 *   building and analyzing WASM modules with full type safety.
 * - Implements **optimization passes** in TypeScript, with performance-critical
 *   ones compiled to WASM via `wasic`.
 * - Runs in **hybrid mode** — delegating complex pass pipelines to the upstream
 *   `binaryen.js` WASM binary while exposing a native TypeScript API surface.
 * - Integrates natively with the `wasmtk` CLI for polyglot WASM development.
 *
 * ## Quick start
 *
 * ```ts
 * import { createModule, BinaryOp, ValType } from "@jrmarcum/binaryang/api";
 * import { writeFile } from "node:fs/promises";
 *
 * const mod = createModule((b, e) => {
 *   b.addFunction("add", [ValType.I32, ValType.I32], [ValType.I32],
 *     e.return(e.binary(BinaryOp.AddI32, e.localGet(0), e.localGet(1)))
 *   );
 *   b.addExport("add", "add");
 * });
 *
 * const wasm = await mod.optimize("-Oz", true); // hybrid mode via wasm-opt
 * await writeFile("add.wasm", wasm);
 * ```
 *
 * ## CLI
 *
 * Runs on Deno, Node 22.18+, and Bun 1.4+. Examples:
 *
 * ```sh
 * # Deno (no install — runs directly from JSR)
 * deno run -A jsr:@jrmarcum/binaryang wasm-opt input.wasm -o out.wasm -Oz
 *
 * # Node (after `npx jsr add @jrmarcum/binaryang`)
 * node --experimental-transform-types node_modules/@jrmarcum/binaryang/main.ts wasm-opt input.wasm
 *
 * # Bun
 * bun node_modules/@jrmarcum/binaryang/main.ts wasm-opt input.wasm
 * ```
 *
 * Node needs `--experimental-transform-types`, NOT `--experimental-strip-types`.
 * Strip-only mode erases types without generating code, so it rejects both
 * TypeScript `enum` (33 of them here, including the opcode tables) and parameter
 * properties. The predecessor projects documented the strip flag and their CLI
 * therefore never ran on Node at all — verified against binaryen-ts 1.5.0.
 *
 * ## Architecture
 *
 * ```
 * binaryen-ts/ts/
 * ├── src/ir/        IR types and module builder  (@jrmarcum/binaryang/ir/binaryen-ts)
 * ├── src/passes/    Optimization pass registry   (@jrmarcum/binaryang/passes)
 * ├── src/tools/     CLI tools (wasm-opt, etc.)
 * ├── src/api/       Unified high-level API       (@jrmarcum/binaryang/api)
 * ├── src/interop/   Upstream binaryen.js bridge  (@jrmarcum/binaryang/interop)
 * └── upstream/      Upstream Binaryen C++ source (git submodule, reference)
 * ```
 *
 * @license MIT
 */

import process from 'node:process';
import { main as wasmOptMain } from './src/binaryen-ts/tools/wasm-opt.ts';
import { main as wat2wasmMain } from './src/wabt-ts/tools/wat2wasm.ts';
import { main as wasm2watMain } from './src/wabt-ts/tools/wasm2wat.ts';
import { main as wasmValidateMain } from './src/wabt-ts/tools/wasm-validate.ts';
import { main as wasmObjdumpMain } from './src/wabt-ts/tools/wasm-objdump.ts';
import { main as wasmStripMain } from './src/wabt-ts/tools/wasm-strip.ts';
import { main as wasm2tsMain } from './src/wabt-ts/tools/wasm2ts.ts';

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

/**
 * Package version.
 *
 * Kept in sync with `deno.json` MECHANICALLY, not by hand: `deno task bump` rewrites
 * this line as well, and `tests/version_sync_test.ts` fails if the two ever disagree.
 * The previous "keep in sync by hand" comment is what this looked like after someone
 * did not — `--version` printed 1.3.4 through two minor releases.
 *
 * It is a literal rather than a read of `deno.json` because this file is a CLI entry
 * for Node and Bun as well as Deno. The original reason was that Node 18 lacked
 * `with { type: 'json' }`; on binaryang's floor (Node 22.18+) that is no longer true,
 * but the literal stays on its own merits -- a runtime read needs `deno.json` to be
 * present and adjacent in the published package, which is a worse coupling than a
 * constant whose drift is closed mechanically by the bump script plus the test.
 */
const VERSION = '1.5.2';

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  'wasm-opt': wasmOptMain,
  'wat2wasm': wat2wasmMain,
  'wasm2wat': wasm2watMain,
  'wasm-validate': wasmValidateMain,
  'wasm-objdump': wasmObjdumpMain,
  'wasm-strip': wasmStripMain,
  'wasm2ts': wasm2tsMain,
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(`binaryang ${VERSION}`);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run with --help to see available commands.`);
    process.exit(1);
  }

  await handler(rest);
}

function printHelp(): void {
  console.log(`binaryang ${VERSION} — TypeScript WebAssembly toolchain (Binaryen + WABT)

USAGE:
  deno run -A jsr:@jrmarcum/binaryang <command> [options]
  node --experimental-transform-types main.ts <command> [options]
  bun main.ts <command> [options]

COMMANDS:
  wasm-opt <input>      Optimize a WASM or WAT file
                        -o <file>     Output file (default: output.wasm)
                        -O0 .. -O4    Optimization level
                        -Os, -Oz      Size optimization (shrink level 1, 2)
                        -S            Emit WAT text
                        --hybrid      Use upstream wasm-opt subprocess
  wat2wasm <input>      Assemble WAT text to a WASM binary
                        -o <file>     Output file (default: stdout)
  wasm2wat <input>      Disassemble a WASM binary to WAT text
                        -o <file>     Output file (default: stdout)
  wasm-validate <input> Validate one or more WASM binaries
                        --enable-all              Enable every proposal
                        --enable-<feature>        Enable one proposal
                        --disable-<feature>       Disable one proposal
  wasm-objdump <input>  Dump sections of a WASM binary
  wasm-strip <input>    Remove custom sections from a WASM binary
                        -o <file>     Output file (default: in place)
                        -s <section>  Section to strip
  wasm2ts <input>       Emit TypeScript from a WASM binary (not yet implemented)

OPTIONS:
  --help, -h            Show this help
  --version, -v         Show version

EXPORTS (JSR):
  @jrmarcum/binaryang/ir/binaryen-ts    Binaryen IR and module builder
  @jrmarcum/binaryang/ir/wabt-ts        WABT IR
  @jrmarcum/binaryang/compat/binaryen   upstream npm:binaryen API shape
  @jrmarcum/binaryang/compat/wabt       upstream wabt.js API shape
  @jrmarcum/binaryang/api               High-level API
  @jrmarcum/binaryang/passes            Pass registry and runner

DOCS:
  https://jsr.io/@jrmarcum/binaryang
`);
}

await main();
