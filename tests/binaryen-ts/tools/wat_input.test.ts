// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// External WAT reaches binaryen-ts through ONE route (owner decision
// 2026-09-10, divergence W4):
//
//   WAT → wabt-ts parser → wabt-ts binary writer → bytes → binaryen-ts decoder
//
// `wasm-opt` read `.wat` with binaryen-ts's own parser, which implements a
// folded subset. Every linear instruction has a folded form by adding
// parentheses, with the missing operands coming from the stack — and that
// parser rejected most of them, block parameters, and the bare linear form our
// own `wasm2wat` writes.
//
// Each case below FAILED through `wasm-opt` before the reroute. Expected values
// for the parenthesised and block-parameter forms are what upstream wat2wasm
// 1.0.41's module returned when probed; the linear case is 4 × 10 − 2. Each
// output is RUN, at no optimization and at -Oz.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertThrows } from '@std/assert';

import { wasmOpt } from '../../../src/binaryen-ts/tools/wasm-opt.ts';
import { readWat, WatInputError } from '../../../src/binaryen-ts/tools/read-wat.ts';
import '../../../src/binaryen-ts/passes/index.ts'; // side-effect: register all built-in passes

const PRE = '(module (import "env" "g" (func $g (param i32) (result i32))) ' +
  '(func (export "f") (result i32) (local i32)';

const CASES: [string, string, number][] = [
  // The parenthesis rule, with operands from the stack.
  ['(i32.add) — both operands from the stack', '(i32.const 1) (i32.const 2) (i32.add)', 3],
  [
    '(select) — all three from the stack',
    '(i32.const 11) (i32.const 22) (i32.const 0) (select)',
    22,
  ],
  [
    '(if (then …)) — condition from the stack',
    '(i32.const 1) (if (result i32) (then (i32.const 7)) (else (i32.const 8)))',
    7,
  ],
  [
    '(br_if 0) — value and condition from the stack',
    '(block (result i32) (i32.const 5) (i32.const 1) (br_if 0))',
    5,
  ],
  // Block parameters, folded.
  [
    'block parameter, consumed by a partial fold',
    '(i32.const 7) (block (param i32) (result i32) (i32.add (i32.const 1)))',
    8,
  ],
  [
    'if parameter in the condition slot',
    '(if (param i32) (result i32) (i32.const 7) (i32.const 1) (then (i32.add (i32.const 1))) (else (i32.sub (i32.const 1))))',
    8,
  ],
  [
    'loop parameter re-supplied by a back-edge',
    '(i32.const 3) (loop $l (param i32) (result i32) (i32.sub (i32.const 1)) (local.tee 0) (br_if $l (local.get 0)))',
    0,
  ],
  // Bare linear form — what `wasm2wat` writes by default.
  ['bare linear form', 'i32.const 4 call $g i32.const 2 i32.sub', 38],
];

async function runF(bytes: Uint8Array): Promise<number> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {
    env: { g: (x: number) => x * 10 },
  });
  return (instance.exports.f as () => number)();
}

async function optimizeText(
  wat: string,
  optimizeLevel: 0 | 2,
  shrinkLevel: 0 | 2,
): Promise<Uint8Array> {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/in.wat`;
    await Deno.writeTextFile(path, wat);
    return await wasmOpt(path, { optimizeLevel, shrinkLevel }) as Uint8Array;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe('wasm-opt reads external WAT through wabt-ts and the decoder', () => {
  for (const [name, body, expected] of CASES) {
    it(name, async () => {
      const wat = `${PRE} ${body}))`;
      assertEquals(await runF(await optimizeText(wat, 0, 0)), expected, 'no optimization');
      assertEquals(await runF(await optimizeText(wat, 2, 2)), expected, '-Oz');
    });
  }
});

describe('the module INTERFACE survives the route — export and import names are never mangled', () => {
  // Owner, 2026-09-10: an exported name must absolutely be preserved, or we
  // have name mangling. Export and import names live in the export and import
  // SECTIONS — the interface — not in the `name` section, so divergence N1
  // (internal `$names` lost on this route) does not reach them. Pinned here so
  // that it never does. Expected lists are upstream wat2wasm 1.0.41's, read
  // back with `WebAssembly.Module.exports` / `.imports`.
  const WAT = `(module
    (import "env" "log" (func $log (param i32)))
    (import "env" "mem" (memory 1))
    (func $internal_name (export "public_name") (result i32) (i32.const 7))
    (func $other (export "second_export") (export "alias_of_second") (call $log (i32.const 1)))
    (global $g (export "exported_global") i32 (i32.const 3))
    (table $t (export "exported_table") 1 funcref)
    (func $unexported)
    (export "late_export" (func $unexported)))`;
  const EXPORTS = [
    { name: 'public_name', kind: 'function' },
    { name: 'second_export', kind: 'function' },
    { name: 'alias_of_second', kind: 'function' },
    { name: 'exported_global', kind: 'global' },
    { name: 'exported_table', kind: 'table' },
    { name: 'late_export', kind: 'function' },
  ];
  const IMPORTS = [
    { module: 'env', name: 'log', kind: 'function' },
    { module: 'env', name: 'mem', kind: 'memory' },
  ];

  for (
    const [label, optimizeLevel, shrinkLevel] of [['no optimization', 0, 0], ['-Oz', 2, 2]] as const
  ) {
    it(label, async () => {
      const m = new WebAssembly.Module(
        await optimizeText(WAT, optimizeLevel, shrinkLevel) as BufferSource,
      );
      assertEquals(WebAssembly.Module.exports(m), EXPORTS);
      assertEquals(WebAssembly.Module.imports(m), IMPORTS);
    });
  }
});

describe('readWat', () => {
  it("reports the text front end's diagnostic, with its position, as a WatInputError", () => {
    const e = assertThrows(() => readWat('(module (func (i32.bogus)))', 'bad.wat'), WatInputError);
    assert(e.message.includes('bad.wat:'), `no position in: ${e.message}`);
  });
});

describe('the wasm-opt CLI', () => {
  it('reports unreadable WAT as a diagnostic and exits 1 — not an uncaught throw', async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${dir}/bad.wat`, '(module (func (i32.bogus)))');
      const entry = new URL('../../../main.ts', import.meta.url);
      const { code, stderr } = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          '--quiet',
          entry.pathname,
          'wasm-opt',
          `${dir}/bad.wat`,
          '-o',
          `${dir}/out.wasm`,
        ],
        stdout: 'piped',
        stderr: 'piped',
      }).output();
      const err = new TextDecoder().decode(stderr);
      assertEquals(code, 1);
      assert(err.startsWith('wasm-opt: '), `not a diagnostic: ${err}`);
      assert(!/Uncaught|\n\s+at /.test(err), `a stack trace leaked: ${err}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
