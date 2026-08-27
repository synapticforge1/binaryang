import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import {
  BinarySection,
  binarySectionName,
  ExternalKind,
  LIMITS_HAS_MAX_FLAG,
  LIMITS_IS_64_FLAG,
  LIMITS_IS_SHARED_FLAG,
  NUM_BINARY_SECTIONS,
  WASM_MAGIC,
  WASM_VERSION,
} from '../../src/core/binary.ts';

describe('Binary format constants', () => {
  it('WASM_MAGIC is 0x6d736100', () => assertEquals(WASM_MAGIC, 0x6d736100));
  it('WASM_VERSION is 1', () => assertEquals(WASM_VERSION, 1));
  it('LIMITS_HAS_MAX_FLAG is 0x1', () => assertEquals(LIMITS_HAS_MAX_FLAG, 0x1));
  it('LIMITS_IS_SHARED_FLAG is 0x2', () => assertEquals(LIMITS_IS_SHARED_FLAG, 0x2));
  it('LIMITS_IS_64_FLAG is 0x4', () => assertEquals(LIMITS_IS_64_FLAG, 0x4));
});

describe('BinarySection', () => {
  const sections: [BinarySection, number, string][] = [
    [BinarySection.Custom, 0, 'custom'],
    [BinarySection.Type, 1, 'type'],
    [BinarySection.Import, 2, 'import'],
    [BinarySection.Function, 3, 'function'],
    [BinarySection.Table, 4, 'table'],
    [BinarySection.Memory, 5, 'memory'],
    [BinarySection.Global, 6, 'global'],
    [BinarySection.Export, 7, 'export'],
    [BinarySection.Start, 8, 'start'],
    [BinarySection.Elem, 9, 'elem'],
    [BinarySection.Code, 10, 'code'],
    [BinarySection.Data, 11, 'data'],
    [BinarySection.DataCount, 12, 'data count'],
    [BinarySection.Tag, 13, 'tag'],
  ];
  it(`NUM_BINARY_SECTIONS is ${sections.length}`, () =>
    assertEquals(NUM_BINARY_SECTIONS, sections.length));
  for (const [section, id, name] of sections) {
    it(`${name} has id ${id}`, () => assertEquals(section, id));
    it(`binarySectionName(${name})`, () => assertEquals(binarySectionName(section), name));
  }
});

describe('ExternalKind', () => {
  it('Func = 0', () => assertEquals(ExternalKind.Func, 0));
  it('Table = 1', () => assertEquals(ExternalKind.Table, 1));
  it('Memory = 2', () => assertEquals(ExternalKind.Memory, 2));
  it('Global = 3', () => assertEquals(ExternalKind.Global, 3));
  it('Tag = 4', () => assertEquals(ExternalKind.Tag, 4));
});
