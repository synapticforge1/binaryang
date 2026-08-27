// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T6.4 — `(module definition …)` and `(module instance …)`.
//
// A DEFINITION declares a module without instantiating it. memory.wast uses
// `(module definition (memory 65536))` for exactly that reason: the module is
// well-formed, but instantiating 65536 pages would be absurd. An INSTANCE
// then instantiates a named definition, possibly several times.
//
// Two shape details that are easy to get wrong:
//   * the keyword comes BEFORE the bind var — `(module definition $M …)`, not
//     `(module $M definition …)` — so it must be consumed before
//     parseBindVarOpt
//   * `(module instance $I $M)` is a COMMAND, not a module; it produces no
//     module of its own and is split off before parseScriptModule
//
// T5.2 — the abbreviated heap-type immediate. `ref.cast i31ref …` is short for
// `ref.cast (ref null i31) …`; a bare `…ref` value type IS the nullable
// reference type. Only the parenthesized form was accepted, so every
// abbreviated ref.cast / ref.test failed with "expected (, got VALUETYPE".
//
// Testsuite: parse-clean 241 -> 249, fully V8-valid 229 -> 237.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWastScript } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

function parseScript(src: string) {
  const { script, errors } = parseWastScript(src);
  if (hasErrors(errors)) throw new Error('parseWastScript:\n' + formatErrors(errors));
  return script;
}

function v8Accepts(wat: string): boolean {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  const buf = new ArrayBuffer(binary.byteLength);
  new Uint8Array(buf).set(binary);
  return WebAssembly.validate(buf);
}

describe('(module definition …)', () => {
  it('parses as a DEFINITION, distinct from a plain module', () => {
    const script = parseScript(`
      (module definition (memory 65536))
      (module (func))`);
    const kinds = script.commands
      .filter((c) => c.kind === 'module')
      .map((c) => (c.kind === 'module' ? c.scriptModule.kind : ''));
    assertEquals(kinds, ['definition', 'text']);
  });

  it('takes its bind var AFTER the keyword', () => {
    const script = parseScript('(module definition $M (func (export "f")))');
    const cmd = script.commands[0];
    assert(cmd && cmd.kind === 'module');
    assertEquals(cmd.scriptModule.kind, 'definition');
    assertEquals(cmd.scriptModule.name, '$M');
  });

  it('is anonymous when no bind var is given', () => {
    const script = parseScript('(module definition (memory 1))');
    const cmd = script.commands[0];
    assert(cmd && cmd.kind === 'module');
    assertEquals(cmd.scriptModule.name, null);
  });

  it('still carries a fully parsed module body', () => {
    const script = parseScript('(module definition $M (func) (func) (memory 1))');
    const cmd = script.commands[0];
    assert(cmd && cmd.kind === 'module' && cmd.scriptModule.kind === 'definition');
    assertEquals(cmd.scriptModule.module.funcs.length, 2);
    assertEquals(cmd.scriptModule.module.memories.length, 1);
  });
});

describe('(module instance …)', () => {
  it('is a command, not a module', () => {
    const script = parseScript(`
      (module definition $M (func (export "f") (result i32) (i32.const 42)))
      (module instance $I1 $M)`);
    assertEquals(script.commands.map((c) => c.kind), ['module', 'module_instance']);
  });

  it('records the instance name and the definition it references', () => {
    const script = parseScript(`
      (module definition $M (func))
      (module instance $I1 $M)`);
    const inst = script.commands[1];
    assert(inst && inst.kind === 'module_instance');
    assertEquals(inst.name, '$I1');
    assertEquals(inst.definition.kind, 'name');
    assertEquals(inst.definition.kind === 'name' ? inst.definition.name : '', '$M');
  });

  it('one definition can be instantiated several times', () => {
    const script = parseScript(`
      (module definition $M (func))
      (module instance $I1 $M)
      (module instance $I2 $M)`);
    const insts = script.commands.filter((c) => c.kind === 'module_instance');
    assertEquals(insts.length, 2);
  });

  it('a plain (module …) is unaffected', () => {
    const script = parseScript('(module (func (export "f")))');
    const cmd = script.commands[0];
    assert(cmd && cmd.kind === 'module');
    assertEquals(cmd.scriptModule.kind, 'text');
  });
});

describe('abbreviated heap-type immediates', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      'ref.cast i31ref',
      '(module (func (param anyref) (result i32) (i31.get_u (ref.cast i31ref (local.get 0)))))',
    ],
    [
      'ref.test anyref',
      '(module (func (param anyref) (result i32) (ref.test anyref (local.get 0))))',
    ],
    [
      'ref.test structref',
      '(module (func (param anyref) (result i32) (ref.test structref (local.get 0))))',
    ],
  ];
  for (const [name, wat] of cases) {
    it(name, () => {
      assert(v8Accepts(wat), `V8 rejected ${wat}`);
    });
  }

  it('the parenthesized forms still work', () => {
    assert(
      v8Accepts(
        '(module (func (param anyref) (result i32) (ref.test (ref null i31) (local.get 0))))',
      ),
    );
    assert(
      v8Accepts('(module (func (param anyref) (result i32) (ref.test (ref i31) (local.get 0))))'),
    );
  });

  it('the bare form is the NULLABLE one', () => {
    // `i31ref` === `(ref null i31)`, so the two must encode identically —
    // and differently from the non-nullable `(ref i31)`.
    const bare = wat2wasm(
      '(module (func (param anyref) (result i32) (ref.test i31ref (local.get 0))))',
    ).binary!;
    const nullable = wat2wasm(
      '(module (func (param anyref) (result i32) (ref.test (ref null i31) (local.get 0))))',
    )
      .binary!;
    const nonNull = wat2wasm(
      '(module (func (param anyref) (result i32) (ref.test (ref i31) (local.get 0))))',
    )
      .binary!;
    assertEquals([...bare], [...nullable], 'i31ref must equal (ref null i31)');
    assert(
      bare.length !== nonNull.length || !bare.every((b, i) => b === nonNull[i]),
      'i31ref must NOT equal the non-nullable (ref i31)',
    );
  });
});
