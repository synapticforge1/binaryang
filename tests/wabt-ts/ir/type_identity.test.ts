// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T7.13 and T7.14 — two ways of losing an identity that a structural
// comparison cannot see.
//
// T7.14: a signature does NOT identify a type. `(sub (func))` and
// `(sub final (func))` are both `() -> ()`, but one is a supertype and the
// other is final, and a function typed as the first is not usable where the
// second is required. `synthesizeTypes` matched types by signature alone and
// OVERWROTE `typeVar` — so `(func $f2 (type $t2))` silently retyped to
// whichever `() -> ()` entry the map happened to hold, and V8 rejected the
// module's element segment with "type error in constant expression (expected
// (ref null 1), got (ref 3))". An explicit type-use is now authoritative.
//
// Suppressing that overwrite immediately exposed a second thing it had been
// masking: `resolveNames` never resolved a DEFINED function's `typeVar`
// (imports were handled, defined funcs were not). The overwrite had been
// papering over the unresolved name-var, so the binary writer's fail-loud
// check started firing across 60 modules the moment it stopped. Both are
// fixed; the name resolution is asserted below on its own.
//
// T7.13: a wasm name is a BYTE STRING, and `TextDecoder` strips a leading
// U+FEFF as a byte-order mark by default. names.wast exports a function whose
// name is exactly the UTF-8 BOM to check that it is preserved; stripping it
// produced a second export named "" and V8 rejected the module for a
// duplicate export name.
//
// Spec testsuite: V8-valid 253 -> 255 (with T7.12 taking it to 257/257).

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../../../src/wabt-ts/ir/synthesize-types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';

function compile(wat: string): Uint8Array {
  const { binary, errors } = wat2wasm(wat);
  if (hasErrors(errors)) throw new Error('wat2wasm:\n' + formatErrors(errors));
  assert(binary);
  return binary;
}

function toBuf(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

function v8Reject(wat: string): string | null {
  try {
    new WebAssembly.Module(toBuf(compile(wat)));
    return null;
  } catch (e) {
    return String(e).replace(/^CompileError: WebAssembly.Module\(\): /, '');
  }
}

/** Parse + resolve + synthesize, and report each func's final type index. */
function funcTypeIndices(wat: string): number[] {
  const { module, errors } = parseWatModule(wat);
  if (hasErrors(errors)) throw new Error(formatErrors(errors));
  resolveNames(module, makeErrorList());
  synthesizeTypes(module);
  return module.funcs.map((f) => (f.typeVar.kind === 'index' ? f.typeVar.value : -1));
}

// type-subtyping.wast's own module: four `() -> ()` types in one subtype
// chain, two funcs naming distinct members of it, and a table typed at the
// middle of the chain.
const SUBTYPES = `(module
  (type $t1 (sub (func)))
  (type $t2 (sub $t1 (func)))
  (type $t3 (sub $t2 (func)))
  (type $t4 (sub final (func)))

  (func $f2 (type $t2))
  (func $f3 (type $t3))
  (table (ref null $t2) (elem $f2 $f3))

  (func (export "run")
    (call_indirect (type $t1) (i32.const 0))
    (call_indirect (type $t1) (i32.const 1))
    (call_indirect (type $t2) (i32.const 0))
    (call_indirect (type $t2) (i32.const 1))
    (call_indirect (type $t3) (i32.const 1))))`;

describe('T7.14 — an explicit type-use is authoritative', () => {
  it('four types sharing one signature stay four distinct types', () => {
    assertEquals(v8Reject(SUBTYPES), null);
  });

  it('each func keeps the type index it named, not a structural match', () => {
    // $f2 -> 1, $f3 -> 2. A structural `() -> ()` match would collapse both
    // onto whichever entry the signature map held.
    assertEquals(funcTypeIndices(SUBTYPES).slice(0, 2), [1, 2]);
  });

  it('a func with no type-use still gets one synthesized', () => {
    assertEquals(
      funcTypeIndices('(module (func) (func (param i32)))'),
      [0, 1],
    );
  });

  it('a type-use alongside an inline signature still uses the named index', () => {
    // The inline part only restates the signature; the index comes from the
    // type-use. Here type 1 is the one named, and type 0 is a decoy with the
    // same signature.
    assertEquals(
      funcTypeIndices(`(module
        (type $a (func (param i32) (result i32)))
        (type $b (func (param i32) (result i32)))
        (func (type $b) (param i32) (result i32) (local.get 0)))`),
      [1],
    );
  });

  it('runs, and the indirect calls reach the right functions', async () => {
    const { instance } = await WebAssembly.instantiate(toBuf(compile(SUBTYPES)));
    // Every call_indirect in "run" must type-check at runtime; a wrong type
    // index traps with "indirect call type mismatch".
    (instance.exports.run as () => void)();
  });
});

describe('T7.14 — resolveNames resolves a defined func type-use', () => {
  it('leaves no name-var on a defined function', () => {
    const { module, errors } = parseWatModule(
      '(module (type $t (func (result f64))) (func $f (type $t) (f64.const 0)))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, makeErrorList());
    assertEquals(module.funcs[0]!.typeVar.kind, 'index');
  });

  it('and on an imported one', () => {
    const { module, errors } = parseWatModule(
      '(module (type $t (func (result f64))) (import "m" "f" (func $f (type $t))))',
    );
    assert(!hasErrors(errors), formatErrors(errors));
    resolveNames(module, makeErrorList());
    const imp = module.imports[0]!;
    assert(imp.kind === 0);
    assertEquals(imp.func.typeVar.kind, 'index');
  });
});

describe('T7.13 — a UTF-8 BOM in a name is a character, not a marker', () => {
  const BOM = '\u{feff}';

  it('an export named with the BOM keeps its name', () => {
    const wat = `(module
      (func (export "a") (result i32) (i32.const 0))
      (func (export "${BOM}") (result i32) (i32.const 1)))`;
    // Stripped, this became a second export named "" — but there is no other
    // empty-named export here, so assert the name survives rather than
    // relying on a duplicate-name rejection.
    const { module, errors } = parseWatModule(wat);
    assert(!hasErrors(errors), formatErrors(errors));
    assertEquals(module.exports.map((e) => e.name), ['a', BOM]);
    assertEquals(v8Reject(wat), null);
  });

  it("names.wast's shape — a BOM export beside a genuinely empty one", () => {
    const wat = `(module
      (func (export "") (result i32) (i32.const 0))
      (func (export "${BOM}") (result i32) (i32.const 1)))`;
    // This is the case that failed: two exports collapsing onto "".
    assertEquals(v8Reject(wat), null);
  });

  it('the BOM survives a binary round-trip', () => {
    const wat = `(module (func (export "${BOM}") (result i32) (i32.const 1)))`;
    const { text, errors } = wasm2wat(compile(wat));
    assert(!hasErrors(errors) && text, formatErrors(errors));
    const { module } = parseWatModule(text);
    assertEquals(module.exports[0]!.name, BOM);
  });

  it('a BOM inside a name, not just leading, is unaffected either way', () => {
    const name = `a${BOM}b`;
    const { module } = parseWatModule(
      `(module (func (export "${name}") (result i32) (i32.const 1)))`,
    );
    assertEquals(module.exports[0]!.name, name);
  });
});
