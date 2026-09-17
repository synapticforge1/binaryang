// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S6 step 5 item 6's ratchet (stage M1): how far wabt-ts's `Module` and
// binaryen-ts's `WasmModule` still are from being ONE type — entity by entity,
// checked by the compiler. The module half's `expr_convergence.test.ts`.
//
// For each entity pair three sets are pinned EXACTLY:
//
//   onlyW  — fields wabt-ts's declaration has and binaryen-ts's does not
//   onlyB  — the reverse
//   differ — fields both have, whose types differ
//
// ⚠️ **A compile-time test: the pins are the assertion.** Each is `Same`d against
// the computed set, so a field that converged and was not un-pinned fails, and
// so does one that diverged again. Progress has to be recorded to land; regress
// cannot land silently. When an entity pair becomes one type, its row goes and
// its identity is pinned instead.
//
// Measured when written (2026-09-16): 46 onlyW, 29 onlyB, 15 differ — 90 field
// differences over 11 entity pairs. Imports are not paired field by field: one
// side is a union embedding the entity, the other flat (stage M4).

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import type * as W from '../../src/wabt-ts/ir/ir.ts';
import type * as B from '../../src/binaryen-ts/ir/module.ts';

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;
type OnlyA<A, C> = Exclude<keyof A, keyof C>;
type Differ<A, C> = {
  [K in keyof A & keyof C]: Same<A[K], C[K]> extends true ? never : K;
}[keyof A & keyof C];
const pin = <A, C>(v: Same<A, C>): Same<A, C> => v;

/** The pinned sets, entity by entity — also what the count below reads. */
const PINNED = {
  module: {
    onlyW: [
      'loc',
      'name',
      'filename',
      'types',
      'funcs',
      'elemSegments',
      'customs',
      'numFuncImports',
      'numTableImports',
      'numMemoryImports',
      'numGlobalImports',
      'numTagImports',
      'sectionMeta',
      'fidelity',
      'hasNameSection',
      'localNamesListed',
      'hasDataCountSection',
      'featuresUsed',
    ],
    onlyB: [
      'functions',
      'elements',
      'hasExceptionHandling',
      'hasMemory64',
      'hasMultiMemory',
      'heapTypes',
      'hasGC',
      'explicitNames',
      'hasDataCount',
      'customSections',
    ],
    differ: [
      'start',
      'imports',
      'tables',
      'memories',
      'globals',
      'tags',
      'dataSegments',
    ],
  },
  func: {
    onlyW: ['loc', 'nodeId', 'typeVar', 'sig', 'typeUse', 'localDecls', 'localNames', 'tailcall'],
    onlyB: ['params', 'results', 'locals', 'bodyFrameLabel'],
    differ: ['body'],
  },
  global: { onlyW: ['loc'], onlyB: [], differ: [] },
  table: { onlyW: ['loc'], onlyB: [], differ: [] },
  memory: { onlyW: ['loc'], onlyB: [], differ: [] },
  tag: { onlyW: ['loc'], onlyB: [], differ: [] },
  elem: {
    onlyW: ['loc', 'kind', 'elemType', 'tableVar', 'elemExprs'],
    onlyB: ['table', 'data', 'mode'],
    differ: [],
  },
  data: { onlyW: ['loc', 'kind', 'memoryVar'], onlyB: ['memory', 'passive'], differ: [] },
  export: { onlyW: [], onlyB: [], differ: [] },
  custom: { onlyW: ['loc'], onlyB: [], differ: [] },
  local: { onlyW: ['count'], onlyB: ['name'], differ: [] },
} as const;

type P = typeof PINNED;
type Of<E extends keyof P, S extends 'onlyW' | 'onlyB' | 'differ'> = P[E][S][number];

describe('S6 step 5 item 6 — Module / WasmModule convergence ratchet', () => {
  it('pins every entity pair exactly (compile-time)', () => {
    pin<OnlyA<W.Module, B.WasmModule>, Of<'module', 'onlyW'>>(true);
    pin<OnlyA<B.WasmModule, W.Module>, Of<'module', 'onlyB'>>(true);
    pin<Differ<W.Module, B.WasmModule>, Of<'module', 'differ'>>(true);

    pin<OnlyA<W.Func, B.WasmFunction>, Of<'func', 'onlyW'>>(true);
    pin<OnlyA<B.WasmFunction, W.Func>, Of<'func', 'onlyB'>>(true);
    pin<Differ<W.Func, B.WasmFunction>, Of<'func', 'differ'>>(true);

    pin<OnlyA<W.Global, B.WasmGlobal>, Of<'global', 'onlyW'>>(true);
    pin<OnlyA<B.WasmGlobal, W.Global>, Of<'global', 'onlyB'>>(true);
    pin<Differ<W.Global, B.WasmGlobal>, Of<'global', 'differ'>>(true);

    pin<OnlyA<W.Table, B.WasmTable>, Of<'table', 'onlyW'>>(true);
    pin<OnlyA<B.WasmTable, W.Table>, Of<'table', 'onlyB'>>(true);
    pin<Differ<W.Table, B.WasmTable>, Of<'table', 'differ'>>(true);

    pin<OnlyA<W.Memory, B.WasmMemory>, Of<'memory', 'onlyW'>>(true);
    pin<OnlyA<B.WasmMemory, W.Memory>, Of<'memory', 'onlyB'>>(true);
    pin<Differ<W.Memory, B.WasmMemory>, Of<'memory', 'differ'>>(true);

    pin<OnlyA<W.Tag, B.WasmTag>, Of<'tag', 'onlyW'>>(true);
    pin<OnlyA<B.WasmTag, W.Tag>, Of<'tag', 'onlyB'>>(true);
    pin<Differ<W.Tag, B.WasmTag>, Of<'tag', 'differ'>>(true);

    pin<OnlyA<W.ElemSegment, B.ElementSegment>, Of<'elem', 'onlyW'>>(true);
    pin<OnlyA<B.ElementSegment, W.ElemSegment>, Of<'elem', 'onlyB'>>(true);
    pin<Differ<W.ElemSegment, B.ElementSegment>, Of<'elem', 'differ'>>(true);

    pin<OnlyA<W.DataSegment, B.DataSegment>, Of<'data', 'onlyW'>>(true);
    pin<OnlyA<B.DataSegment, W.DataSegment>, Of<'data', 'onlyB'>>(true);
    pin<Differ<W.DataSegment, B.DataSegment>, Of<'data', 'differ'>>(true);

    pin<OnlyA<W.Export, B.WasmExport>, Of<'export', 'onlyW'>>(true);
    pin<OnlyA<B.WasmExport, W.Export>, Of<'export', 'onlyB'>>(true);
    pin<Differ<W.Export, B.WasmExport>, Of<'export', 'differ'>>(true);

    pin<OnlyA<W.Custom, B.CustomSection>, Of<'custom', 'onlyW'>>(true);
    pin<OnlyA<B.CustomSection, W.Custom>, Of<'custom', 'onlyB'>>(true);
    pin<Differ<W.Custom, B.CustomSection>, Of<'custom', 'differ'>>(true);

    pin<OnlyA<W.LocalDecl, B.Local>, Of<'local', 'onlyW'>>(true);
    pin<OnlyA<B.Local, W.LocalDecl>, Of<'local', 'onlyB'>>(true);
    pin<Differ<W.LocalDecl, B.Local>, Of<'local', 'differ'>>(true);
  });

  it('records the distance', () => {
    const count = (s: 'onlyW' | 'onlyB' | 'differ') =>
      Object.values(PINNED).reduce((n, e) => n + e[s].length, 0);
    // The type check above is the assertion; this keeps the numbers readable.
    assertEquals([count('onlyW'), count('onlyB'), count('differ')], [40, 20, 8]);
  });
});
