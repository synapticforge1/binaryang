/**
 * @module
 * binaryang — the merged WebAssembly toolchain: a TypeScript port of Binaryen
 * and of WABT in one package, replacing `@jrmarcum/binaryen-ts` and
 * `@jrmarcum/wabt-ts`. This root is the CLI; the libraries are its subpaths.
 *
 * ## CLI
 *
 * Runs on Deno, Node 22.18+, and Bun 1.4+:
 *
 * ```sh
 * # Deno — no install, straight from JSR
 * deno run -A jsr:@jrmarcum/binaryang --help
 * deno run -A jsr:@jrmarcum/binaryang wat2wasm add.wat -o add.wasm
 * deno run -A jsr:@jrmarcum/binaryang wasm-opt add.wasm -o add.min.wasm -Oz
 *
 * # Node (after `npx jsr add @jrmarcum/binaryang`)
 * node node_modules/@jrmarcum/binaryang/main.js wasm-opt input.wasm
 *
 * # Bun
 * bun node_modules/@jrmarcum/binaryang/main.ts wasm-opt input.wasm
 * ```
 *
 * Node needs no flag: the installed package is compiled JavaScript, and this source is
 * erasable TypeScript (open-work 28 part 4, 2026-10-12), which Node's default type stripping
 * runs (22.18 through 26).
 *
 * The dispatcher runs only when this module is the program's entry
 * (`import.meta.main` — the reason Node's floor is 22.18). 🔧 Until 1.6.1 the
 * root was `src/index.ts`, which has no dispatcher, so the command above
 * printed nothing and exited 0; and this file ran its dispatcher on IMPORT.
 *
 * ## The libraries
 *
 * | subpath | what |
 * | ------- | ---- |
 * | `./ir` | the IR, its builder and factories, and the vocabulary tool results use |
 * | `./compat/binaryen`, `./compat/wabt` | the two upstream API shapes |
 * | `./api`, `./passes`, `./wasm` | the Binaryen side: building, optimizing |
 * | `./wat2wasm`, `./wasm2wat`, `./wasm-validate`, `./wasm-objdump`, `./wasm-strip`, `./tools/wasm-opt` | each tool as a library function (`wat2wasm(text)`, …) |
 *
 * The root itself exports only what both halves genuinely share — today
 * nothing (`src/index.ts`, re-exported below, says why).
 *
 * Upstream C++ is cited by its upstream path (`WebAssembly/binaryen/src/…`,
 * `WebAssembly/wabt`); it is not part of this repository.
 *
 * @license MIT
 */

import { main as wasmOptMain } from './src/tools/wasm-opt.ts';
import { main as wat2wasmMain } from './src/tools/wat2wasm.ts';
import { main as wasm2watMain } from './src/tools/wasm2wat.ts';
import { main as wasmValidateMain } from './src/tools/wasm-validate.ts';
import { main as wasmObjdumpMain } from './src/tools/wasm-objdump.ts';
import { main as wasmStripMain } from './src/tools/wasm-strip.ts';
import { main as wasm2tsMain } from './src/tools/wasm2ts.ts';
import { main as wasmCtorEvalMain } from './src/tools/wasm-ctor-eval.ts';
import { main as wasmInterpMain } from './src/tools/wasm-interp.ts';
import { main as wasmBundleMain } from './src/tools/wasm-bundle.ts';
import { cliExit, cliProcess } from './src/cli/io.ts';

export * from './src/index.ts';

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

/**
 * Package version.
 *
 * Kept in sync with the package manifest, `jsr.json` (`deno.json` until 2026-10-12),
 * MECHANICALLY, not by hand: `bun run bump` rewrites
 * this line as well, and `tests/binaryen-ts/version_sync.test.ts` fails if the two ever disagree.
 * The previous "keep in sync by hand" comment is what this looked like after someone
 * did not — `--version` printed 1.3.4 through two minor releases.
 *
 * It is a literal rather than a read of the manifest because this file is a CLI entry
 * for Node and Bun as well as Deno. The original reason was that Node 18 lacked
 * `with { type: 'json' }`; on binaryang's floor (Node 22.18+) that is no longer true,
 * but the literal stays on its own merits -- a runtime read needs the manifest to be
 * present and adjacent in the published package, which is a worse coupling than a
 * constant whose drift is closed mechanically by the bump script plus the test.
 */
const VERSION = '1.12.0';

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  'wasm-opt': wasmOptMain,
  'wat2wasm': wat2wasmMain,
  'wasm2wat': wasm2watMain,
  'wasm-validate': wasmValidateMain,
  'wasm-objdump': wasmObjdumpMain,
  'wasm-strip': wasmStripMain,
  'wasm2ts': wasm2tsMain,
  'wasm-ctor-eval': wasmCtorEvalMain,
  'wasm-interp': wasmInterpMain,
  'wasm-bundle': wasmBundleMain,
};

async function main(): Promise<void> {
  const [command, ...rest] = cliProcess().argv.slice(2);

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
    cliExit(1);
  }

  await handler(rest);
}

function printHelp(): void {
  console.log(`binaryang ${VERSION} — TypeScript WebAssembly toolchain (Binaryen + WABT)

USAGE:
  deno run -A jsr:@jrmarcum/binaryang <command> [options]
  node main.ts <command> [options]
  bun main.ts <command> [options]

COMMANDS:
  wasm-opt <input>      Optimize a WASM or WAT file
                        -o <file>     Output file (default: output.wasm)
                        -O0 .. -O4    Optimization level
                        -Os, -Oz      Size optimization (shrink level 1, 2)
                        -S            Emit WAT text
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
  wasm-ctor-eval <input> Run constructors at build time and write their state into the module
                        -o <file>                 Output file (default: output.wasm)
                        --ctors=a,b               Exported functions to evaluate, in order
                        --kept-exports=a,b        Keep these exports once fully evaluated
                        --ignore-external-input   Assume no arguments or environment
                        -S                        Emit WAT text
  wasm-interp <input>   Run exported functions on the interpreter and print the results
                        --run-all-exports         Every exported function, zero arguments
                        --run-export=NAME         One export, with --argument=V (repeat)
                        --dummy-import-func       Imported functions return zeros
                        --hang-check=SECONDS      Stop a loop that provably never exits
                                                  (checked every 2 s by default)
  wasm-bundle <in>...   Bundle modules into one, with one memory relocated exactly
                        -o <file>                 Output file (default: bundle.wasm)
                        --on-conflict=MODE        Same export in two inputs: prefix | alias | exclude
                        --alias a.wasm=m,...      Name inputs (the prefix; what others import from)
                        --unmarked=guess          Relocate an unmarked input by address range
                        --start=NAME              Whose _start stays _start
                        --no-wit                  Do not write <output>.wit beside the bundle
                        -S                        Emit WAT text

OPTIONS:
  --help, -h            Show this help
  --version, -v         Show version

EXPORTS (JSR):
  @jrmarcum/binaryang/ir                The IR, its module builder and result types
  @jrmarcum/binaryang/compat/binaryen   upstream npm:binaryen API shape
  @jrmarcum/binaryang/compat/wabt       upstream wabt.js API shape
  @jrmarcum/binaryang/api               High-level API
  @jrmarcum/binaryang/passes            Pass registry and runner

DOCS:
  https://jsr.io/@jrmarcum/binaryang
`);
}

// Only as the program's entry: an `import` of the package root must not run
// the CLI (it would read the importer's argv and could `process.exit`).
// The cast: `import.meta.main` exists at run time on Deno, Bun and Node 22.18+, but
// only SOME type environments declare it (Deno's do, `@types/node` does, and with no
// deno.json `deno publish` checks this file with neither: Bun migration B7).
if ((import.meta as { main?: boolean }).main) await main();
