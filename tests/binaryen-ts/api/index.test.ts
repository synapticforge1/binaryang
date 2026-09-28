/**
 * @module binaryen-ts/tests/api/index_test
 *
 * Tests for the high-level `createModule` / `Module` API in `src/binaryen-ts/api/index.ts`.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';
import { createModule } from '../../../src/binaryen-ts/api/index.ts';
import {
  asRegion,
  BinaryOp,
  makeBinary,
  makeBlock,
  makeF64Const,
  makeI32Const,
  makeI64Const,
  makeLocalGet,
  makeLoop,
  makeNop,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { None, ValType } from '../../../src/binaryen-ts/ir/types.ts';
import { ExternalKind } from '../../../src/wabt-ts/core/binary.ts';
import { varIndex, varName } from '../../../src/wabt-ts/ir/ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import '../../../src/binaryen-ts/passes/index.ts'; // register built-in passes

Deno.test('toWat writes every kind, and the text assembles to the same module (K4)', () => {
  // 🔧 `toWat` had its own partial serializer: it printed a `binary` as its
  // numeric opcode (`(106 …)` for `i32.add`), threw on `loop` and most kinds,
  // and `optimize(…, hybrid)` fed its text to upstream `wasm-opt`. It is the
  // wabt-ts WAT writer now (`writeWat`), which `wasm2wat` uses. A label the API
  // names without its `$` (`makeLoop('l', …)`) prints as `$l`, not `$""`.
  const mod = createModule(() => {});
  mod.ir.functions.push({
    name: '$f',
    sig: { params: [ValType.I32], results: [ValType.I32] },
    locals: [],
    body: asRegion(
      makeBlock(
        [
          makeLoop('l', makeNop(), None),
          makeBinary(BinaryOp.AddI32, makeLocalGet(varIndex(0), ValType.I32), makeI32Const(1)),
        ],
        null,
        ValType.I32,
      ),
    ),
  });
  mod.ir.exports.push({ name: 'f', var: varName('$f'), kind: ExternalKind.Func });
  const wat = mod.toWat();
  assert(wat.includes('i32.add') && wat.includes('(loop $l'), wat);
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), `assembles:\n${wat}`);
  const f = new WebAssembly.Instance(new WebAssembly.Module(r.binary as BufferSource)).exports
    .f as (x: number) => number;
  assertEquals(f(41), 42);
});

Deno.test('Module.optimize honors the -O level (was hardcoded to 2)', async () => {
  // A removable `nop` followed by the real result: Vacuum (level ≥ 1) drops it,
  // so -Oz output is strictly smaller than -O0 (which now runs NO passes). Before
  // the fix, optimizeLevel was hardcoded to 2 and `-O0` produced identical bytes.
  const build = () => {
    const mod = createModule(() => {});
    mod.ir.functions.push({
      name: '$f',
      sig: { params: [], results: [ValType.I32] },
      locals: [],
      body: asRegion(makeBlock([makeNop(), makeI32Const(5)], null)),
    });
    return mod;
  };
  const o0 = await build().optimize('-O0');
  const oz = await build().optimize('-Oz');
  assert(o0.length > oz.length, `expected -O0 (${o0.length}) > -Oz (${oz.length})`);
});

Deno.test('toWat: an export prints its kind KEYWORD, not the byte that represents it', () => {
  // S6 step 5 item 6 (M2e): `WasmExport.kind` is the binary's kind byte now. The
  // serializer interpolated it -- `(${exp.kind} ...)` -- which compiles either
  // way and would print `(0 $f)`. Before M2e it printed `(function $f)`, which
  // is not WAT either: the keyword is `func`.
  // The entities exist now: the writer resolves every reference, and exporting
  // names the module does not have is refused (as the encoder refused it).
  const mod = createModule(() => {});
  Object.assign(
    mod.ir,
    readWat(`(module (func $func) (table $table 1 funcref) (memory $memory 1)
      (global $global i32 (i32.const 0)) (tag $tag))`),
  );
  const kinds: [ExternalKind, string][] = [
    [ExternalKind.Func, 'func'],
    [ExternalKind.Table, 'table'],
    [ExternalKind.Memory, 'memory'],
    [ExternalKind.Global, 'global'],
    [ExternalKind.Tag, 'tag'],
  ];
  for (const [kind, kw] of kinds) mod.ir.exports.push({ name: kw, var: varName(`$${kw}`), kind });
  const wat = mod.toWat();
  // The writer prints an export INLINE on its entity — `(func $func (export
  // "func") …)` — so each keyword appears as the entity's own; and the text
  // assembles to a module that exports each with that kind.
  for (const [, kw] of kinds) {
    assert(wat.includes(`(${kw} $${kw} (export "${kw}")`), `expected ${kw} in:\n${wat}`);
  }
  const r = wat2wasm(wat);
  assert(!hasErrors(r.errors), `assembles:\n${wat}`);
  const exported = WebAssembly.Module.exports(new WebAssembly.Module(r.binary as BufferSource));
  assertEquals(
    exported.map((e) => [e.name, e.kind]),
    [['func', 'function'], ['table', 'table'], ['memory', 'memory'], ['global', 'global'], [
      'tag',
      'tag',
    ]],
  );
});

Deno.test('toWat: value types print as their NAMES, not as the bytes that represent them', () => {
  // S6 step 5, stage V1: `ValType` holds the wire bytes now (`I32 = 0x7f`). This
  // serializer interpolated types straight into the text -- `(param $p0 ${t})` --
  // which compiles either way and would have printed `(param $p0 127)`. No test
  // read its output, so nothing said so; a type-aware sweep found it.
  const mod = createModule(() => {});
  mod.ir.globals.push(
    {
      name: '$g',
      type: ValType.F64,
      mutable: true,
      init: asRegion(makeF64Const(1.5)),
    } as (typeof mod.ir.globals)[number],
  );
  mod.ir.functions.push({
    name: '$f',
    sig: { params: [ValType.I32], results: [ValType.I64] },
    locals: [{ type: ValType.I32 }, { type: ValType.F32, name: '$x' }],
    body: asRegion(makeBlock([makeI64Const(7n)], null, ValType.I64)),
  });
  const wat = mod.toWat();
  for (
    // `(param i32)`, no `$p0`: the old serializer made that name up, and the
    // writer prints only names the module has.
    const want of ['(param i32)', '(result i64)', '(mut f64)', '(local $x f32)', '(result i64)']
  ) {
    assert(wat.includes(want), `expected ${want} in:\n${wat}`);
  }
  assert(
    !/\b(1[0-2][0-9])\b/.test(wat.replace(/\$\w+/g, '')),
    `a type printed as a byte in:\n${wat}`,
  );
});
