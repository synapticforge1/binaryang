// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Runs every module in <dir>/index.json on THIS JavaScript engine (Node, Deno or Bun): compile,
// instantiate, call `t`. One JSON line per module: { file, s: ok|trap|refused|error, v?, m? }.
// Plain, erasable TypeScript, so Node runs it as it is.
//   node js-run.ts <dir>   |   deno run -A js-run.ts <dir>   |   bun js-run.ts <dir>

import { readFileSync } from 'node:fs';
import process from 'node:process';

const dir = process.argv[2];
const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as { file: string }[];
const W = WebAssembly as unknown as { Exception?: new () => unknown };
for (const { file } of index) {
  const bytes = readFileSync(`${dir}/wasm/${file}`);
  let r: { s: string; v?: string; m?: string };
  try {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    try {
      r = {
        s: 'ok',
        v: BigInt.asUintN(64, BigInt((inst.exports['t'] as () => bigint)())).toString(16),
      };
    } catch (e) {
      // An uncaught wasm exception ends the call as a trap does; JS reports it as WebAssembly.Exception.
      const trapped = e instanceof WebAssembly.RuntimeError ||
        (W.Exception !== undefined && e instanceof W.Exception);
      r = { s: trapped ? 'trap' : 'error', m: String((e as Error)?.message ?? e) };
    }
  } catch (e) {
    r = { s: 'refused', m: String((e as Error)?.message ?? e) };
  }
  console.log(JSON.stringify({ file, ...r }));
}
