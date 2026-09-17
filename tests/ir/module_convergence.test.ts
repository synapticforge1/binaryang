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
import type * as BG from '../../src/binaryen-ts/ir/gc-types.ts';

type Same<A, C> = [A] extends [C] ? ([C] extends [A] ? true : false) : false;
type OnlyA<A, C> = Exclude<keyof A, keyof C>;
type Differ<A, C> = {
  [K in keyof A & keyof C]: Same<A[K], C[K]> extends true ? never : K;
}[keyof A & keyof C];
const pin = <A, C>(v: Same<A, C>): Same<A, C> => v;

/** One arm of an import union, by kind — the pair is compared arm by arm (M4). */
type ArmW<K extends W.Import['kind']> = Extract<W.Import, { kind: K }>;
type ArmB<K extends B.WasmImport['kind']> = Extract<B.WasmImport, { kind: K }>;

/** One shape of type entry, by its `kind` — the pair is compared shape by shape (M5). */
type TypeW<K extends W.TypeEntry['kind']> = Extract<W.TypeEntry, { kind: K }>;
type TypeB<K extends B.TypeDef['kind']> = Extract<B.TypeDef, { kind: K }>;

/** The pinned sets, entity by entity — also what the count below reads. */
const PINNED = {
  module: {
    onlyW: [
      'loc',
      'name',
      'filename',
      'sectionMeta',
      'fidelity',
      'hasNameSection',
      'localNamesListed',
      'hasDataCountSection',
      'featuresUsed',
    ],
    onlyB: [
      'hasExceptionHandling',
      'hasMemory64',
      'hasMultiMemory',
      'hasGC',
      'explicitNames',
      'hasDataCount',
    ],
    differ: [
      'start',
      'imports',
      'tables',
      'memories',
      'globals',
      'tags',
      'dataSegments',
      'types',
      'functions',
      'elements',
      'customSections',
    ],
  },
  func: {
    onlyW: ['loc', 'nodeId', 'typeVar', 'typeUse', 'tailcall'],
    onlyB: ['bodyFrameLabel'],
    differ: [],
  },
  global: { onlyW: ['loc'], onlyB: [], differ: [] },
  table: { onlyW: ['loc'], onlyB: [], differ: [] },
  memory: { onlyW: ['loc'], onlyB: [], differ: [] },
  tag: { onlyW: ['loc'], onlyB: [], differ: [] },
  elem: { onlyW: ['loc'], onlyB: [], differ: [] },
  data: { onlyW: ['loc'], onlyB: [], differ: [] },
  export: { onlyW: [], onlyB: [], differ: [] },
  custom: { onlyW: ['loc'], onlyB: [], differ: [] },
  local: { onlyW: [], onlyB: [], differ: [] },
  // M4 made imports comparable: each arm holds `kind` / `module` / `field` and the
  // entity itself, so what differs is the EMBEDDED record — `loc` on four of
  // them, and the function record until M6.
  importFunc: { onlyW: [], onlyB: [], differ: ['func'] },
  importTable: { onlyW: [], onlyB: [], differ: ['table'] },
  importMemory: { onlyW: [], onlyB: [], differ: ['memory'] },
  importGlobal: { onlyW: [], onlyB: [], differ: ['global'] },
  importTag: { onlyW: [], onlyB: [], differ: ['tag'] },
  // A type entry, by shape (M5). `loc` is wabt-ts's, as on every other record.
  typeFunc: { onlyW: ['loc'], onlyB: [], differ: [] },
  // A field's `type` is each side's own `StorageType` — the last value-type pair
  // left unmerged, and what makes the struct / array entries differ too.
  typeStruct: { onlyW: ['loc'], onlyB: [], differ: ['fields'] },
  typeArray: { onlyW: ['loc'], onlyB: [], differ: ['field'] },
  field: { onlyW: [], onlyB: [], differ: ['type'] },
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

    pin<OnlyA<W.Local, B.Local>, Of<'local', 'onlyW'>>(true);
    pin<OnlyA<B.Local, W.Local>, Of<'local', 'onlyB'>>(true);
    pin<Differ<W.Local, B.Local>, Of<'local', 'differ'>>(true);

    pin<OnlyA<ArmW<0>, ArmB<0>>, Of<'importFunc', 'onlyW'>>(true);
    pin<OnlyA<ArmB<0>, ArmW<0>>, Of<'importFunc', 'onlyB'>>(true);
    pin<Differ<ArmW<0>, ArmB<0>>, Of<'importFunc', 'differ'>>(true);

    pin<OnlyA<ArmW<1>, ArmB<1>>, Of<'importTable', 'onlyW'>>(true);
    pin<OnlyA<ArmB<1>, ArmW<1>>, Of<'importTable', 'onlyB'>>(true);
    pin<Differ<ArmW<1>, ArmB<1>>, Of<'importTable', 'differ'>>(true);

    pin<OnlyA<ArmW<2>, ArmB<2>>, Of<'importMemory', 'onlyW'>>(true);
    pin<OnlyA<ArmB<2>, ArmW<2>>, Of<'importMemory', 'onlyB'>>(true);
    pin<Differ<ArmW<2>, ArmB<2>>, Of<'importMemory', 'differ'>>(true);

    pin<OnlyA<ArmW<3>, ArmB<3>>, Of<'importGlobal', 'onlyW'>>(true);
    pin<OnlyA<ArmB<3>, ArmW<3>>, Of<'importGlobal', 'onlyB'>>(true);
    pin<Differ<ArmW<3>, ArmB<3>>, Of<'importGlobal', 'differ'>>(true);

    pin<OnlyA<TypeW<'func'>, TypeB<'func'>>, Of<'typeFunc', 'onlyW'>>(true);
    pin<OnlyA<TypeB<'func'>, TypeW<'func'>>, Of<'typeFunc', 'onlyB'>>(true);
    pin<Differ<TypeW<'func'>, TypeB<'func'>>, Of<'typeFunc', 'differ'>>(true);

    pin<OnlyA<TypeW<'struct'>, TypeB<'struct'>>, Of<'typeStruct', 'onlyW'>>(true);
    pin<OnlyA<TypeB<'struct'>, TypeW<'struct'>>, Of<'typeStruct', 'onlyB'>>(true);
    pin<Differ<TypeW<'struct'>, TypeB<'struct'>>, Of<'typeStruct', 'differ'>>(true);

    pin<OnlyA<TypeW<'array'>, TypeB<'array'>>, Of<'typeArray', 'onlyW'>>(true);
    pin<OnlyA<TypeB<'array'>, TypeW<'array'>>, Of<'typeArray', 'onlyB'>>(true);
    pin<Differ<TypeW<'array'>, TypeB<'array'>>, Of<'typeArray', 'differ'>>(true);

    pin<OnlyA<W.Field, BG.FieldType>, Of<'field', 'onlyW'>>(true);
    pin<OnlyA<BG.FieldType, W.Field>, Of<'field', 'onlyB'>>(true);
    pin<Differ<W.Field, BG.FieldType>, Of<'field', 'differ'>>(true);

    pin<OnlyA<ArmW<4>, ArmB<4>>, Of<'importTag', 'onlyW'>>(true);
    pin<OnlyA<ArmB<4>, ArmW<4>>, Of<'importTag', 'onlyB'>>(true);
    pin<Differ<ArmW<4>, ArmB<4>>, Of<'importTag', 'differ'>>(true);
  });

  it('records the distance', () => {
    const count = (s: 'onlyW' | 'onlyB' | 'differ') =>
      Object.values(PINNED).reduce((n, e) => n + e[s].length, 0);
    // The type check above is the assertion; this keeps the numbers readable.
    assertEquals([count('onlyW'), count('onlyB'), count('differ')], [24, 7, 19]);
  });
});
