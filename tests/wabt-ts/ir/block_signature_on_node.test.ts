// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5, stage (c2): a block-type carrier holds its SIGNATURE, and the index
// its header named as FORM — `type` + `params.types` + `typeIndex?`, binaryen-ts's
// shape (decisions 7a/7b(i)/7c: semantics on the node, the written index beside
// it).
//
// 🔧 It held `blockType`: `void`, one value type, or `func_type` — an index and
// NOTHING ELSE, so a block with parameters or several results knew its own
// signature only by looking it up in the module. And the fidelity table held a
// copy of the same field.
//
// The header a node WRITES is derived by `blockTypeOf`. Because the node now
// spells its signature twice where it names an index, the validator checks the
// two agree — otherwise it would type-check one program and the writer would
// emit another.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import {
  type BlockExpr,
  blockTypeOf,
  type Expr,
  type Module,
  UNASSIGNED_TYPE_INDEX,
} from '../../../src/wabt-ts/ir/ir.ts';
import { Type } from '../../../src/wabt-ts/core/types.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';
import { ModuleContext } from '../../../src/wabt-ts/ir/ir-util.ts';

function compile(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  assert(r.binary);
  return r.binary;
}

type Carrier = Extract<Expr, { kind: 'block' | 'loop' | 'if' | 'try' | 'try_table' }>;

/** The first carrier in function `fn`, however deeply nested. */
function carrierOf(m: Module, fn = 0): Carrier {
  const stack: unknown[] = [m.functions[fn]!.body.children];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    const k = (v as { kind?: unknown }).kind;
    if (k === 'block' || k === 'loop' || k === 'if' || k === 'try' || k === 'try_table') {
      return v as Carrier;
    }
    stack.push(...Object.values(v));
  }
  throw new Error('no carrier');
}

/** The first carrier, from the binary AND from the text (resolved). */
function both(wat: string): [string, Carrier][] {
  const errors = makeErrorList();
  const bin = readBinaryIr(compile(wat), errors);
  assert(!hasErrors(errors), formatErrors(errors));
  const text = parseWatModule(wat);
  assert(!hasErrors(text.errors), formatErrors(text.errors));
  resolveNames(text.module, text.errors);
  assert(!hasErrors(text.errors), formatErrors(text.errors));
  return [['binary reader', carrierOf(bin)], ['text parser', carrierOf(text.module)]];
}

describe('the carrier holds its signature', () => {
  it('no result: `none`, and no index', () => {
    for (const [path, c] of both('(module (func (block (nop))))')) {
      assertEquals(c.type, 'none', path);
      assertEquals(c.typeIndex, undefined, path);
      assertEquals(blockTypeOf(c).kind, 'void', path);
    }
  });

  it('one inline result: the value type itself, and no index', () => {
    for (
      const [path, c] of both('(module (func (result i32) (block (result i32) (i32.const 1))))')
    ) {
      assertEquals(c.type, Type.I32, path);
      assertEquals(c.typeIndex, undefined, path);
      assertEquals(blockTypeOf(c).kind, 'value', path);
    }
  });

  it('several results: a list, and the index the header needs', () => {
    const wat = '(module (func (result i32)' +
      ' (block (result i32 i64) (i32.const 1) (i64.const 2)) (drop)))';
    for (const [path, c] of both(wat)) {
      assertEquals(c.type, [Type.I32, Type.I64], path);
      assert(c.typeIndex !== undefined && c.typeIndex >= 0, `${path}: ${c.typeIndex}`);
    }
  });

  it('parameters: `params.types`, the results, and the index', () => {
    const wat = '(module (func (result i32) i32.const 1 block (param i32) (result i32) end))';
    for (const [path, c] of both(wat)) {
      assertEquals(c.params?.types, [Type.I32], path);
      assertEquals(c.type, Type.I32, path);
      assert(c.typeIndex !== undefined && c.typeIndex >= 0, `${path}: ${c.typeIndex}`);
    }
  });

  it('a header naming the SECOND of two identical types keeps that index', () => {
    const wat =
      '(module (type $a (func (param i32) (result i32))) (type $b (func (param i32) (result i32)))' +
      ' (func (type $a) local.get 0 block (type $b) end))';
    for (const [path, c] of both(wat)) assertEquals(c.typeIndex, 1, path);
  });
});

describe('blockTypeOf — the three header spellings', () => {
  const base = {
    kind: 'block',
    label: '',
    body: [],
    loc: { filename: '', line: 0, column: 0, offset: 0 },
  } as const;

  it('an index, when one was written', () => {
    assertEquals(blockTypeOf({ ...base, type: Type.I32, typeIndex: 4 }), {
      kind: 'func_type',
      typeIdx: 4,
    });
  });
  it('0x40 or the inline type, when none was and none is needed', () => {
    assertEquals(blockTypeOf({ ...base, type: 'none' }), { kind: 'void' });
    assertEquals(blockTypeOf({ ...base, type: Type.F64 }), { kind: 'value', type: Type.F64 });
  });
  it('unwritable, when an index is needed and there is none', () => {
    const unassigned = { kind: 'func_type' as const, typeIdx: UNASSIGNED_TYPE_INDEX };
    assertEquals(blockTypeOf({ ...base, type: [Type.I32, Type.I32] }), unassigned);
    assertEquals(
      blockTypeOf({ ...base, type: 'none', params: { types: [Type.I32], values: [] } }),
      unassigned,
    );
  });
});

describe('the validator holds the two spellings to each other', () => {
  const WAT =
    '(module (type $p (func (param i32) (result i32))) (type $q (func (param i32) (result i64)))' +
    ' (func (result i32) i32.const 1 block (type $p) end))';

  /** Validate function 0 after replacing its carrier by `patch(carrier)`. */
  function validateWith(patch: (c: BlockExpr) => BlockExpr): string[] {
    const errors = makeErrorList();
    const m = readBinaryIr(compile(WAT), errors);
    assert(!hasErrors(errors), formatErrors(errors));
    const body = m.functions[0]!.body.children as Expr[];
    body[0] = patch(body[0] as BlockExpr);
    validateModule(m, errors, { features: allFeatures() });
    return hasErrors(errors)
      ? formatErrors(errors).split('\n').filter((l) => l.includes('error'))
      : [];
  }

  it('control: the decoded node validates', () => {
    assertEquals(validateWith((c) => c), []);
  });

  it('an index naming ANOTHER signature is rejected, naming the index', () => {
    // The node says `(i32) -> i32`; its header now names type 1, `(i32) -> i64`.
    const errs = validateWith((c) => ({ ...c, typeIndex: 1 }));
    assert(errs.some((e) => e.includes('does not match type 1')), errs.join('\n'));
  });

  it('a signature changed under an unchanged index is rejected too', () => {
    const errs = validateWith((c) => ({ ...c, type: Type.I64 }));
    assert(errs.some((e) => e.includes('does not match type 0')), errs.join('\n'));
  });

  it('a header that needs an index and has none is rejected, not written as -1', () => {
    const errs = validateWith((c) => {
      const { typeIndex: _dropped, ...rest } = c;
      return rest;
    });
    assert(errs.some((e) => e.includes('needs a type index')), errs.join('\n'));
  });
});

describe('typed references in the node signature are resolved', () => {
  // The node now holds every result and parameter; before, anything past one
  // result lived only in the type-section entry, which is resolved separately.
  // Left as `(ref $s)` against the entry's resolved `(ref 0)`, the validator's
  // agreement check would reject a valid module.
  // ⚠️ `wat2wasm` alone cannot see this: it validates what it reads back from its
  // own bytes, and the header writes the INDEX. Two mutants that left the list
  // and the parameters unresolved survived the whole suite. The contract is
  // resolveNames' own — no name-form reference survives it — so the resolved
  // TEXT tree is checked directly, and validated as it stands.
  it('resolveNames leaves no `$s` in the node signature, and the text tree validates', () => {
    const wat = '(module (type $s (struct))' +
      ' (func (result i32)' +
      '   (ref.null $s)' +
      '   (block (param (ref null $s)) (result (ref null $s) i32) (i32.const 7))' +
      '   (drop) (drop) (i32.const 7)))';
    const { module, errors } = parseWatModule(wat);
    resolveNames(module, errors);
    assert(!hasErrors(errors), formatErrors(errors));
    const c = carrierOf(module);
    const refs = [...(c.params?.types ?? []), ...(Array.isArray(c.type) ? c.type : [])];
    assertEquals(refs.length, 3);
    for (const vt of refs) {
      if (typeof vt === 'object') assertEquals(vt.heapType, { kind: 'index', value: 0 });
    }
    validateModule(module, errors, { features: allFeatures() });
    assert(!hasErrors(errors), formatErrors(errors));
  });

  it('several results and a parameter, all `(ref null $s)`, assemble and run', () => {
    const wat = '(module (type $s (struct))' +
      ' (func (export "f") (result i32)' +
      '   (ref.null $s)' +
      '   (block (param (ref null $s)) (result (ref null $s) i32) (i32.const 7))' +
      '   (drop) (drop) (i32.const 7)))';
    const bytes = compile(wat);
    const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), {});
    assertEquals((inst.exports.f as () => number)(), 7);
  });
});

describe('arity reads the declared results from the node', () => {
  // `ModuleContext.getExprArity` is public and has no internal caller, so a
  // mutant returning 0 for every carrier survived the suite.
  it('none, one, and several results', () => {
    const wat = '(module (func (result i32 i64)' +
      ' (block (nop)) (block (result i32) (i32.const 1)) (drop)' +
      ' (block (result i32 i64) (i32.const 1) (i64.const 2))))';
    const errors = makeErrorList();
    const m = readBinaryIr(compile(wat), errors);
    assert(!hasErrors(errors), formatErrors(errors));
    const ctx = new ModuleContext(m);
    const find = (e: Expr): Expr[] =>
      e.kind === 'block'
        ? [e]
        : Object.values(e).flatMap((v) =>
          v !== null && typeof v === 'object' && 'kind' in v ? find(v as Expr) : []
        );
    const carriers = (m.functions[0]!.body.children as Expr[]).flatMap(find);
    assertEquals(carriers.map((c) => ctx.getExprArity(c).nreturns), [0, 1, 2]);
  });
});
