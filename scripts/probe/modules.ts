// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The probe modules that measure D4 (open-work 34; cmem/portability.md): every one exports
 * `t: () -> i64`, so any engine that can print an i64 can be compared with any other.
 *
 * - **typed** — one module per D1 entry with a concrete stack signature: fixed inputs, every result
 *   folded into the i64 (pass 1, 2026-10-23).
 * - **template** — hand-written modules for the entries D1 leaves untyped (control, references,
 *   tables, exceptions, GC, custom descriptors) and for the features that are encodings, not
 *   opcodes; each states its value or a trap (pass 2).
 * - **failure** — the failure paths the specification defines: division, truncation, every memory
 *   access one past the end, unaligned atomics, bulk memory; a trap, or the exact value where the
 *   spec says it does not trap (pass 3).
 * - **encoding** — a mutable exported global and a branch hint.
 *
 * Assembled by `wasm-tools parse` (and `wat2wasm` for the legacy exception syntax wasm-tools does
 * not parse, divergence G4), validated by `wasm-tools validate --features=all`: the probe does not
 * let binaryang build what it measures.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/** One module, as the probe's `index.json` lists it. */
export interface ProbeModule {
  file: string;
  kind: 'typed' | 'template' | 'failure' | 'encoding';
  /** The D2 feature it needs, or `core`. */
  feature: string;
  /** The D1 entries it exercises. */
  covers: string[];
  /** What it must produce: a hex value, or `trap`. Absent: whatever the engines agree on. */
  expect?: string;
}

type D1Entry = {
  name: string;
  class: string;
  feature: string | null;
  immediates: string[];
  signature: { params: string[]; results: string[] } | null;
};

const D1 = (JSON.parse(
  readFileSync(new URL('../../src/definitions/opcodes.json', import.meta.url), 'utf8'),
) as {
  entries: D1Entry[];
}).entries;

/** Fold the results (top of stack first) into one i64. */
function fold(results: string[]): { locals: string; code: string } {
  const locals = results.map((r, i) => `(local $r${i} ${r === 'addr' ? 'i32' : r})`).join(' ');
  const sets = results.map((_, i) => `local.set $r${results.length - 1 - i}`).join(' ');
  const conv = (r: string, i: number) => {
    const g = `local.get $r${i}`;
    switch (r) {
      case 'i32':
      case 'addr':
        return `${g} i64.extend_i32_u`;
      case 'i64':
        return g;
      case 'f32':
        return `${g} i32.reinterpret_f32 i64.extend_i32_u`;
      case 'f64':
        return `${g} i64.reinterpret_f64`;
      case 'v128':
        return `${g} i64x2.extract_lane 0 ${g} i64x2.extract_lane 1 i64.const 1 i64.rotl i64.xor`;
      default:
        throw new Error(`result type ${r}`);
    }
  };
  const acc = results.map((r, i) => `i64.const 13 i64.rotl ${conv(r, i)} i64.xor`).join(' ');
  return { locals, code: `${sets} i64.const 0 ${acc}` };
}

// ---- typed: one per D1 entry with a signature ----

const ARG: Record<string, string> = {
  addr: '(i32.const 0)',
  i32: '(i32.const 1)',
  i64: '(i64.const 1)',
  f32: '(f32.const 1.5)',
  f64: '(f64.const 2.5)',
  v128: '(v128.const i32x4 0x04030201 0x08070605 0x7f0b0a09 0x80ff0d0c)',
};
/** An instruction's immediates in text; `null` for one this does not fill (reported, not guessed). */
function immText(e: D1Entry): string | null {
  const t: string[] = [];
  for (const k of e.immediates) {
    if (k === 'memarg' || k === 'memidx' || k === 'zerobyte') continue;
    const v = ({
      laneidx: '0',
      lane16: '0 17 2 19 4 21 6 23 8 25 10 27 12 29 14 31',
      dataidx: '$d',
      i32: '1',
      i64: '1',
      f32: '1.5',
      f64: '1.5',
      v128: 'i32x4 1 2 3 4',
    } as Record<string, string>)[k];
    if (v === undefined) return null;
    t.push(v);
  }
  return t.join(' ');
}
const PATTERN = '"\\01\\02\\03\\04\\05\\06\\07\\08\\f0\\0f\\ff\\7f\\80\\00\\41\\c0"';

function typed(): { id: string; wat: string; m: Omit<ProbeModule, 'file'> }[] {
  const out: { id: string; wat: string; m: Omit<ProbeModule, 'file'> }[] = [];
  D1.forEach((e, i) => {
    if (!e.signature) return;
    const imm = immText(e);
    if (imm === null) return;
    const { locals, code } = fold(e.signature.results);
    const wat = `(module
  (memory 1 1${e.feature === 'threads' ? ' shared' : ''})
  (data (i32.const 0) ${PATTERN})
  (data $d ${PATTERN})
  (func (export "t") (result i64) ${locals}
    ${e.signature.params.map((p) => ARG[p]).join(' ')}
    ${e.name}${imm ? ` ${imm}` : ''}
    ${code}))
`;
    out.push({
      id: `${String(i).padStart(3, '0')}-${e.name.replace(/[^a-z0-9_.]+/gi, '_')}`,
      wat,
      m: { kind: 'typed', feature: e.feature ?? 'core', covers: [e.name] },
    });
  });
  return out;
}

// ---- template: the untyped entries and the encoding-level features ----

type Template = {
  id: string;
  feature: string;
  covers: string[];
  expect: string;
  body: string;
  fields?: string;
  legacy?: true;
};
const H =
  '(type $sig (func (param i64) (result i64))) (func $h (type $sig) local.get 0 i64.const 1 i64.add) (elem declare func $h)';
const TBL = '(table $tb 4 funcref) (elem (table $tb) (i32.const 0) func $h)';
const TAG = '(tag $e (param i64))';
const GC =
  '(type $s (struct (field (mut i64)) (field (mut i8)))) (type $a (array (mut i64))) (type $a8 (array (mut i8))) (type $af (array (mut funcref)))';
const DATA = '(memory 1) (data $d "\\01\\02\\03\\04\\ff\\06\\07\\08")';
const DESC =
  '(rec (type $t (descriptor $dt) (struct (field i64))) (type $dt (describes $t) (struct (field i64))))';
const DESC0 =
  '(rec (type $t (descriptor $dt) (struct (field i64))) (type $dt (describes $t) (struct)))';

const TEMPLATES: Template[] = [
  // control
  {
    id: 'unreachable',
    feature: 'core',
    covers: ['unreachable'],
    expect: 'trap',
    body: 'unreachable',
  },
  {
    id: 'block',
    feature: 'core',
    covers: ['block', 'end'],
    expect: '7',
    body: 'block (result i64) i64.const 7 end',
  },
  {
    id: 'loop',
    feature: 'core',
    covers: ['loop', 'br_if'],
    expect: '3',
    body:
      '(local $i i32) loop $l local.get $i i32.const 1 i32.add local.tee $i i32.const 3 i32.lt_u br_if $l end local.get $i i64.extend_i32_u',
  },
  {
    id: 'if-else',
    feature: 'core',
    covers: ['if', 'else'],
    expect: '2',
    body: 'i32.const 0 if (result i64) i64.const 1 else i64.const 2 end',
  },
  {
    id: 'br',
    feature: 'core',
    covers: ['br'],
    expect: '5',
    body: 'block $b (result i64) i64.const 5 br $b end',
  },
  {
    id: 'br_if',
    feature: 'core',
    covers: ['br_if'],
    expect: '6',
    body: 'block $b (result i64) i64.const 6 i32.const 1 br_if $b drop i64.const 9 end',
  },
  {
    id: 'br_table',
    feature: 'core',
    covers: ['br_table'],
    expect: '16',
    body:
      'block $b0 (result i64) block $b1 (result i64) block $b2 (result i64) i64.const 22 i32.const 2 br_table $b2 $b1 $b0 $b0 end i64.const 0 i64.add end drop i64.const 11 end drop i64.const 22',
  },
  { id: 'return', feature: 'core', covers: ['return'], expect: '4', body: 'i64.const 4 return' },
  {
    id: 'call',
    feature: 'core',
    covers: ['call'],
    fields: H,
    expect: '2a',
    body: 'i64.const 41 call $h',
  },
  {
    id: 'call_indirect',
    feature: 'core',
    covers: ['call_indirect'],
    fields: `${H} ${TBL}`,
    expect: '2a',
    body: 'i64.const 41 i32.const 0 call_indirect $tb (type $sig)',
  },
  {
    id: 'drop',
    feature: 'core',
    covers: ['drop'],
    expect: '1',
    body: 'i64.const 1 i64.const 2 drop',
  },
  {
    id: 'select',
    feature: 'core',
    covers: ['select'],
    expect: '2',
    body: 'i64.const 1 i64.const 2 i32.const 0 select',
  },
  {
    id: 'select-typed',
    feature: 'referenceTypes',
    covers: ['select'],
    expect: '2',
    body: 'i64.const 1 i64.const 2 i32.const 0 select (result i64)',
  },
  {
    id: 'locals',
    feature: 'core',
    covers: ['local.get', 'local.set', 'local.tee'],
    expect: 'e',
    body: '(local $x i64) i64.const 7 local.tee $x local.get $x i64.add local.set $x local.get $x',
  },
  {
    id: 'globals',
    feature: 'core',
    covers: ['global.get', 'global.set'],
    fields: '(global $g (mut i64) (i64.const 1))',
    expect: '9',
    body: 'i64.const 9 global.set $g global.get $g',
  },
  // tail calls
  {
    id: 'return_call',
    feature: 'tailCall',
    covers: ['return_call'],
    fields: H,
    expect: '2a',
    body: 'i64.const 41 return_call $h',
  },
  {
    id: 'return_call_indirect',
    feature: 'tailCall',
    covers: ['return_call_indirect'],
    fields: `${H} ${TBL}`,
    expect: '2a',
    body: 'i64.const 41 i32.const 0 return_call_indirect $tb (type $sig)',
  },
  {
    id: 'return_call_ref',
    // D1 gates it under functionReferences (open-work 40), the proposal that defines it.
    feature: 'functionReferences',
    covers: ['return_call_ref'],
    fields: H,
    expect: '2a',
    body: 'i64.const 41 ref.func $h return_call_ref $sig',
  },
  // reference types, typed function references
  {
    id: 'ref.null',
    feature: 'referenceTypes',
    covers: ['ref.null', 'ref.is_null'],
    expect: '1',
    body: 'ref.null func ref.is_null i64.extend_i32_u',
  },
  {
    id: 'ref.func',
    feature: 'referenceTypes',
    covers: ['ref.func', 'ref.is_null'],
    fields: H,
    expect: '0',
    body: 'ref.func $h ref.is_null i64.extend_i32_u',
  },
  {
    id: 'call_ref',
    feature: 'functionReferences',
    covers: ['call_ref'],
    fields: H,
    expect: '2a',
    body: 'i64.const 41 ref.func $h call_ref $sig',
  },
  {
    id: 'ref.as_non_null',
    feature: 'functionReferences',
    covers: ['ref.as_non_null'],
    fields: H,
    expect: '2a',
    body: 'i64.const 41 ref.func $h ref.as_non_null call_ref $sig',
  },
  {
    id: 'ref.as_non_null-trap',
    feature: 'functionReferences',
    covers: ['ref.as_non_null'],
    fields: H,
    expect: 'trap',
    body: 'i64.const 41 ref.null $sig ref.as_non_null call_ref $sig',
  },
  {
    id: 'br_on_null',
    feature: 'functionReferences',
    covers: ['br_on_null'],
    fields: H,
    expect: '63',
    body: 'block $n i64.const 41 ref.null $sig br_on_null $n call_ref $sig return end i64.const 99',
  },
  {
    id: 'br_on_non_null',
    feature: 'functionReferences',
    covers: ['br_on_non_null'],
    fields: H,
    expect: '2a',
    body:
      'i64.const 41 block $nn (param i64) (result i64 (ref $sig)) ref.func $h br_on_non_null $nn drop i64.const 99 return end call_ref $sig',
  },
  // tables and element segments
  {
    id: 'table.get',
    feature: 'referenceTypes',
    covers: ['table.get'],
    fields: `${H} ${TBL}`,
    expect: '0',
    body: 'i32.const 0 table.get $tb ref.is_null i64.extend_i32_u',
  },
  {
    id: 'table.set',
    feature: 'referenceTypes',
    covers: ['table.set'],
    fields: `${H} ${TBL}`,
    expect: '0',
    body:
      'i32.const 2 ref.func $h table.set $tb i32.const 2 table.get $tb ref.is_null i64.extend_i32_u',
  },
  {
    id: 'table.size',
    feature: 'referenceTypes',
    covers: ['table.size'],
    fields: `${H} ${TBL}`,
    expect: '4',
    body: 'table.size $tb i64.extend_i32_u',
  },
  {
    id: 'table.grow',
    feature: 'referenceTypes',
    covers: ['table.grow'],
    fields: `${H} ${TBL}`,
    expect: '6',
    body: 'ref.null func i32.const 2 table.grow $tb drop table.size $tb i64.extend_i32_u',
  },
  {
    id: 'table.fill',
    feature: 'referenceTypes',
    covers: ['table.fill'],
    fields: `${H} ${TBL}`,
    expect: '0',
    body:
      'i32.const 1 ref.func $h i32.const 3 table.fill $tb i32.const 3 table.get $tb ref.is_null i64.extend_i32_u',
  },
  {
    id: 'table.copy',
    feature: 'bulkMemory',
    covers: ['table.copy'],
    fields: `${H} ${TBL}`,
    expect: '0',
    body:
      'i32.const 3 i32.const 0 i32.const 1 table.copy $tb $tb i32.const 3 table.get $tb ref.is_null i64.extend_i32_u',
  },
  {
    id: 'table.init',
    feature: 'bulkMemory',
    covers: ['table.init'],
    fields: `${H} (table $tb 4 funcref) (elem $pe func $h)`,
    expect: '0',
    body:
      'i32.const 1 i32.const 0 i32.const 1 table.init $tb $pe i32.const 1 table.get $tb ref.is_null i64.extend_i32_u',
  },
  {
    id: 'elem.drop',
    feature: 'bulkMemory',
    covers: ['elem.drop'],
    fields: `${H} (table $tb 4 funcref) (elem $pe func $h)`,
    expect: 'trap',
    body: 'elem.drop $pe i32.const 1 i32.const 0 i32.const 1 table.init $tb $pe i64.const 0',
  },
  // exceptions, the standard form
  {
    id: 'try_table',
    feature: 'exceptions',
    covers: ['try_table', 'throw'],
    fields: TAG,
    expect: '8',
    body: 'block $c (result i64) try_table (catch $e $c) i64.const 8 throw $e end i64.const 0 end',
  },
  {
    id: 'throw_ref',
    feature: 'exceptions',
    covers: ['throw_ref', 'try_table'],
    fields: TAG,
    expect: '3',
    body:
      'block $o (result i64) try_table (catch $e $o) block $r (result exnref) try_table (catch_all_ref $r) i64.const 3 throw $e end unreachable end throw_ref end i64.const 0 end',
  },
  {
    id: 'throw-uncaught',
    feature: 'exceptions',
    covers: ['throw'],
    fields: TAG,
    expect: 'trap',
    body: 'i64.const 1 throw $e',
  },
  // exceptions, the legacy form
  {
    id: 'try-catch',
    feature: 'exceptions',
    covers: ['try', 'catch'],
    fields: TAG,
    legacy: true,
    expect: '8',
    body: 'try (result i64) i64.const 8 throw $e catch $e end',
  },
  {
    id: 'catch_all',
    feature: 'exceptions',
    covers: ['try', 'catch_all'],
    fields: TAG,
    legacy: true,
    expect: '9',
    body: 'try (result i64) i64.const 8 throw $e catch_all i64.const 9 end',
  },
  {
    id: 'rethrow',
    feature: 'exceptions',
    covers: ['rethrow'],
    fields: TAG,
    legacy: true,
    expect: '8',
    body:
      'try (result i64) try i64.const 8 throw $e catch $e drop rethrow 0 end i64.const 0 catch $e end',
  },
  {
    id: 'delegate',
    feature: 'exceptions',
    covers: ['delegate'],
    fields: TAG,
    legacy: true,
    expect: '8',
    body: 'try (result i64) try i64.const 8 throw $e delegate 0 i64.const 0 catch $e end',
  },
  // GC
  {
    id: 'struct.new',
    feature: 'gc',
    covers: ['struct.new', 'struct.get'],
    fields: GC,
    expect: '5',
    body: 'i64.const 5 i32.const 3 struct.new $s struct.get $s 0',
  },
  {
    id: 'struct.new_default',
    feature: 'gc',
    covers: ['struct.new_default'],
    fields: GC,
    expect: '0',
    body: 'struct.new_default $s struct.get $s 0',
  },
  {
    id: 'struct.get_s',
    feature: 'gc',
    covers: ['struct.get_s'],
    fields: GC,
    expect: 'ffffffffffffffff',
    body: 'i64.const 0 i32.const 255 struct.new $s struct.get_s $s 1 i64.extend_i32_s',
  },
  {
    id: 'struct.get_u',
    feature: 'gc',
    covers: ['struct.get_u'],
    fields: GC,
    expect: 'ff',
    body: 'i64.const 0 i32.const 255 struct.new $s struct.get_u $s 1 i64.extend_i32_u',
  },
  {
    id: 'struct.set',
    feature: 'gc',
    covers: ['struct.set'],
    fields: GC,
    expect: '9',
    body:
      '(local $r (ref null $s)) struct.new_default $s local.tee $r i64.const 9 struct.set $s 0 local.get $r struct.get $s 0',
  },
  {
    id: 'array.new',
    feature: 'gc',
    covers: ['array.new', 'array.get'],
    fields: GC,
    expect: '4',
    body: 'i64.const 4 i32.const 3 array.new $a i32.const 1 array.get $a',
  },
  {
    id: 'array.new_default',
    feature: 'gc',
    covers: ['array.new_default', 'array.len'],
    fields: GC,
    expect: '3',
    body: 'i32.const 3 array.new_default $a array.len i64.extend_i32_u',
  },
  {
    id: 'array.new_fixed',
    feature: 'gc',
    covers: ['array.new_fixed'],
    fields: GC,
    expect: '3',
    body: 'i64.const 1 i64.const 2 i64.const 3 array.new_fixed $a 3 i32.const 2 array.get $a',
  },
  {
    id: 'array.new_data',
    feature: 'gc',
    covers: ['array.new_data', 'array.get_u'],
    fields: `${GC} ${DATA}`,
    expect: 'ff',
    body:
      'i32.const 0 i32.const 8 array.new_data $a8 $d i32.const 4 array.get_u $a8 i64.extend_i32_u',
  },
  {
    id: 'array.get_s',
    feature: 'gc',
    covers: ['array.get_s'],
    fields: `${GC} ${DATA}`,
    expect: 'ffffffffffffffff',
    body:
      'i32.const 0 i32.const 8 array.new_data $a8 $d i32.const 4 array.get_s $a8 i64.extend_i32_s',
  },
  {
    id: 'array.new_elem',
    feature: 'gc',
    covers: ['array.new_elem'],
    fields: `${GC} ${H} (elem $pe func $h)`,
    expect: '0',
    body:
      'i32.const 0 i32.const 1 array.new_elem $af $pe i32.const 0 array.get $af ref.is_null i64.extend_i32_u',
  },
  {
    id: 'array.set',
    feature: 'gc',
    covers: ['array.set'],
    fields: GC,
    expect: '7',
    body:
      '(local $r (ref null $a)) i32.const 2 array.new_default $a local.tee $r i32.const 1 i64.const 7 array.set $a local.get $r i32.const 1 array.get $a',
  },
  {
    id: 'array.fill',
    feature: 'gc',
    covers: ['array.fill'],
    fields: GC,
    expect: '6',
    body:
      '(local $r (ref null $a)) i32.const 4 array.new_default $a local.tee $r i32.const 1 i64.const 6 i32.const 3 array.fill $a local.get $r i32.const 3 array.get $a',
  },
  {
    id: 'array.copy',
    feature: 'gc',
    covers: ['array.copy'],
    fields: GC,
    expect: '2',
    body:
      '(local $r (ref null $a)) i32.const 3 array.new_default $a local.tee $r i32.const 0 i64.const 1 i64.const 2 i64.const 3 array.new_fixed $a 3 i32.const 1 i32.const 2 array.copy $a $a local.get $r i32.const 0 array.get $a',
  },
  {
    id: 'array.init_data',
    feature: 'gc',
    covers: ['array.init_data'],
    fields: `${GC} ${DATA}`,
    expect: '3',
    body:
      '(local $r (ref null $a8)) i32.const 4 array.new_default $a8 local.tee $r i32.const 0 i32.const 2 i32.const 2 array.init_data $a8 $d local.get $r i32.const 0 array.get_u $a8 i64.extend_i32_u',
  },
  {
    id: 'array.init_elem',
    feature: 'gc',
    covers: ['array.init_elem'],
    fields: `${GC} ${H} (elem $pe func $h)`,
    expect: '0',
    body:
      '(local $r (ref null $af)) i32.const 2 array.new_default $af local.tee $r i32.const 1 i32.const 0 i32.const 1 array.init_elem $af $pe local.get $r i32.const 1 array.get $af ref.is_null i64.extend_i32_u',
  },
  {
    id: 'ref.test',
    feature: 'gc',
    covers: ['ref.test'],
    fields: GC,
    expect: '1',
    body: 'struct.new_default $s ref.test (ref $s) i64.extend_i32_u',
  },
  {
    id: 'ref.test-null',
    feature: 'gc',
    covers: ['ref.test null'],
    fields: GC,
    expect: '1',
    body: 'ref.null $s ref.test (ref null $s) i64.extend_i32_u',
  },
  {
    id: 'ref.cast',
    feature: 'gc',
    covers: ['ref.cast'],
    fields: GC,
    expect: '0',
    body: 'struct.new_default $s ref.cast (ref $s) struct.get $s 0',
  },
  {
    id: 'ref.cast-null',
    feature: 'gc',
    covers: ['ref.cast null'],
    fields: GC,
    expect: '1',
    body: 'ref.null any ref.cast (ref null $s) ref.is_null i64.extend_i32_u',
  },
  {
    id: 'ref.cast-trap',
    feature: 'gc',
    covers: ['ref.cast'],
    fields: GC,
    expect: 'trap',
    body: 'i32.const 1 ref.i31 ref.cast (ref $s) struct.get $s 0',
  },
  {
    id: 'br_on_cast',
    feature: 'gc',
    covers: ['br_on_cast'],
    fields: GC,
    expect: '5',
    body:
      'block $b (result (ref $s)) i64.const 5 i32.const 0 struct.new $s br_on_cast $b anyref (ref $s) drop i64.const 99 return end struct.get $s 0',
  },
  {
    id: 'br_on_cast_fail',
    feature: 'gc',
    covers: ['br_on_cast_fail'],
    fields: GC,
    expect: '63',
    body:
      'block $b (result anyref) i32.const 1 ref.i31 br_on_cast_fail $b anyref (ref $s) struct.get $s 0 return end drop i64.const 99',
  },
  {
    id: 'extern-any',
    feature: 'gc',
    covers: ['extern.convert_any', 'any.convert_extern'],
    fields: GC,
    expect: '7',
    body:
      'i32.const 7 ref.i31 extern.convert_any any.convert_extern ref.cast (ref i31) i31.get_u i64.extend_i32_u',
  },
  {
    id: 'i31',
    feature: 'gc',
    covers: ['ref.i31', 'i31.get_s', 'i31.get_u'],
    fields: GC,
    expect: '7fffffff',
    body:
      'i32.const -1 ref.i31 i31.get_u i32.const -1 ref.i31 i31.get_s i32.const 1 i32.add i32.add i64.extend_i32_u',
  },
  {
    id: 'ref.eq',
    feature: 'gc',
    covers: ['ref.eq'],
    fields: GC,
    expect: '1',
    body: 'i32.const 1 ref.i31 i32.const 1 ref.i31 ref.eq i64.extend_i32_u',
  },
  // custom descriptors (proposal; syntax per wasm-tools)
  {
    id: 'struct.new_desc',
    feature: 'customDescriptors',
    covers: ['struct.new_desc', 'ref.get_desc'],
    expect: '5',
    fields: DESC,
    body:
      'i64.const 1 i64.const 5 struct.new $dt struct.new_desc $t ref.get_desc $t struct.get $dt 0',
  },
  {
    id: 'struct.new_default_desc',
    feature: 'customDescriptors',
    covers: ['struct.new_default_desc'],
    expect: '0',
    fields: DESC,
    body: 'struct.new_default $dt struct.new_default_desc $t struct.get $t 0',
  },
  {
    id: 'ref.cast_desc_eq',
    feature: 'customDescriptors',
    covers: ['ref.cast_desc_eq', 'ref.cast_desc_eq null'],
    expect: '1',
    fields: DESC0,
    body:
      '(local $d (ref null (exact $dt))) struct.new $dt local.set $d i64.const 1 local.get $d struct.new_desc $t local.get $d ref.cast_desc_eq (ref $t) struct.get $t 0 ref.null any local.get $d ref.cast_desc_eq (ref null $t) drop',
  },
  {
    id: 'br_on_cast_desc_eq',
    feature: 'customDescriptors',
    covers: ['br_on_cast_desc_eq', 'br_on_cast_desc_eq_fail'],
    expect: '1',
    fields: DESC0,
    body:
      '(local $d (ref null (exact $dt))) struct.new $dt local.set $d block $b (result (ref $t)) i64.const 1 local.get $d struct.new_desc $t local.get $d br_on_cast_desc_eq $b anyref (ref $t) drop i64.const 99 return end struct.get $t 0 block $f (result anyref) ref.null any local.get $d br_on_cast_desc_eq_fail $f anyref (ref $t) drop ref.null any end drop',
  },
  // features that are encodings, not opcodes
  {
    id: 'feat-multi-value',
    feature: 'multiValue',
    covers: [],
    expect: '3',
    body: 'block (result i64 i64) i64.const 1 i64.const 2 end i64.add',
  },
  {
    id: 'feat-memory64',
    feature: 'memory64',
    covers: [],
    fields: '(memory i64 1) (data (i64.const 0) "\\2a")',
    expect: '2a',
    body: 'i64.const 0 i64.load8_u',
  },
  {
    id: 'feat-table64',
    feature: 'memory64',
    covers: [],
    fields: `${H} (table $t64 i64 2 funcref) (elem (table $t64) (i64.const 0) func $h)`,
    expect: '2a',
    body: 'i64.const 41 i64.const 0 call_indirect $t64 (type $sig)',
  },
  {
    id: 'feat-multi-memory',
    feature: 'multiMemory',
    covers: [],
    fields: '(memory $m0 1) (memory $m1 1) (data (memory $m1) (i32.const 0) "\\05")',
    expect: '5',
    body: 'i32.const 0 i64.load8_u $m1',
  },
  {
    id: 'feat-custom-page-sizes',
    feature: 'customPageSizes',
    covers: [],
    fields: '(memory 3 (pagesize 1))',
    expect: '3',
    body: 'memory.size i64.extend_i32_u',
  },
  {
    id: 'feat-extended-const',
    feature: 'extendedConst',
    covers: [],
    fields: '(global $g i64 (i64.add (i64.const 2) (i64.mul (i64.const 3) (i64.const 4))))',
    expect: 'e',
    body: 'global.get $g',
  },
];

function templates(): { id: string; wat: string; legacy?: true; m: Omit<ProbeModule, 'file'> }[] {
  return TEMPLATES.map((x) => {
    const locals = x.body.match(/^\s*(\(local [^)]*\)\s*)+/)?.[0] ?? '';
    return {
      id: `p2-${x.id}`,
      wat: `(module\n  ${x.fields ?? ''}\n  (func (export "t") (result i64) ${locals}\n    ${
        x.body.slice(locals.length)
      }))\n`,
      ...(x.legacy ? { legacy: true as const } : {}),
      m: { kind: 'template', feature: x.feature, covers: x.covers, expect: x.expect },
    };
  });
}

// ---- failure: the failure paths of the typed opcodes ----

function failures(): { id: string; wat: string; m: Omit<ProbeModule, 'file'> }[] {
  const out: { id: string; wat: string; m: Omit<ProbeModule, 'file'> }[] = [];
  const zero: Record<string, string> = {
    i32: '(i32.const 0)',
    i64: '(i64.const 0)',
    f32: '(f32.const 0)',
    f64: '(f64.const 0)',
    v128: '(v128.const i64x2 0 0)',
  };
  const one: Record<string, string> = {
    i32: '(i32.const 1)',
    i64: '(i64.const 1)',
    f32: '(f32.const 1)',
    f64: '(f64.const 1)',
    v128: '(v128.const i64x2 1 1)',
  };
  const OOB = '(i32.const 65536)'; // one-page memory: the first address past the end
  const pattern = '"\\01\\02\\03\\04\\05\\06\\07\\08"';
  const add = (e: D1Entry, tag: string, expect: string, args: string[]) => {
    const { locals, code } = fold(e.signature!.results);
    const imm = e.immediates.filter((k) => k === 'laneidx').map(() => '0').join(' ');
    out.push({
      id: `p3-${`${e.name}-${tag}`.replace(/[^a-z0-9_.-]+/gi, '_')}`,
      wat: `(module
  (memory 1 1${e.feature === 'threads' ? ' shared' : ''})
  (data (i32.const 0) ${pattern})
  (func (export "t") (result i64) ${locals}
    ${args.join(' ')}
    ${e.name}${imm ? ` ${imm}` : ''}
    ${code}))
`,
      m: { kind: 'failure', feature: e.feature ?? 'core', covers: [e.name], expect },
    });
  };
  const operand = (
    t: string,
  ) => (t === 'addr' ? '(i32.const 0)' : t === 'i32' ? '(i32.const 1)' : one[t] ?? zero[t]!);
  for (const e of D1) {
    if (!e.signature) continue;
    const p = e.signature.params;
    const n = e.name;
    // integer division
    if (/^i(32|64)\.(div|rem)_[su]$/.test(n)) {
      const t = n.slice(0, 3);
      add(e, 'by-zero', 'trap', [one[t]!, zero[t]!]);
      if (n.endsWith('_s')) {
        const min = t === 'i32' ? '(i32.const -2147483648)' : '(i64.const -9223372036854775808)';
        // div_s INT_MIN / -1 overflows; rem_s INT_MIN % -1 is defined as 0.
        add(e, 'min-by-neg1', n.includes('div') ? 'trap' : '0', [min, `(${t}.const -1)`]);
      }
    }
    // float to int truncation: traps on NaN and out of range; the _sat forms clamp instead
    const tr = n.match(/^i(32|64)\.trunc_(sat_)?f(32|64)_([su])$/);
    if (tr) {
      const ft = `f${tr[3]}`;
      const sat = Boolean(tr[2]);
      const bits = Number(tr[1]);
      const max = tr[4] === 's' ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
      add(e, 'nan', sat ? '0' : 'trap', [`(${ft}.const nan)`]);
      add(e, 'too-big', sat ? max.toString(16) : 'trap', [`(${ft}.const 1e30)`]);
    }
    // every memory access at the first address past a one-page memory
    // (memory.init and data.drop need a segment: the BULK cases below cover them)
    if (
      (e.class === 'memory' || e.class === 'simd-memory' || e.class === 'atomic') &&
      p[0] === 'addr' &&
      !/^(memory\.(size|grow|init)|data\.drop)$/.test(n)
    ) {
      // memory.fill / memory.copy take a length typed `addr`, so it is 0 here: a zero-length access
      // AT the end is in bounds (d + n <= size) and must NOT trap; past the end is the BULK cases.
      if (n === 'memory.fill' || n === 'memory.copy') {
        add(e, 'len0-at-end', '0', p.map((t, i) => (i === 0 ? OOB : operand(t))));
      } else add(e, 'oob', 'trap', p.map((t, i) => (i === 0 ? OOB : operand(t))));
    }
    // atomics wider than a byte trap when unaligned (wait and notify included)
    if (
      e.class === 'atomic' && p[0] === 'addr' &&
      !/8(_u)?$|\.atomic\.(rmw8|load8|store8)|rmw8/.test(n)
    ) {
      add(e, 'unaligned', 'trap', p.map((t, i) => (i === 0 ? '(i32.const 1)' : operand(t))));
    }
  }
  const BULK = [
    {
      id: 'memory.fill-straddles-end',
      op: 'memory.fill',
      body: '(memory.fill (i32.const 65535) (i32.const 0) (i32.const 2))',
    },
    {
      id: 'memory.copy-straddles-end',
      op: 'memory.copy',
      body: '(memory.copy (i32.const 65535) (i32.const 0) (i32.const 2))',
    },
    {
      id: 'memory.init-oob',
      op: 'memory.init',
      body: '(memory.init $d (i32.const 65535) (i32.const 0) (i32.const 2))',
    },
    {
      id: 'data.drop-then-init',
      op: 'data.drop',
      body: '(data.drop $d) (memory.init $d (i32.const 0) (i32.const 0) (i32.const 1))',
    },
    {
      id: 'memory.fill-len0-past-end',
      op: 'memory.fill',
      body: '(memory.fill (i32.const 65537) (i32.const 0) (i32.const 0))',
    },
  ];
  for (const b of BULK) {
    out.push({
      id: `p3-${b.id}`,
      wat:
        `(module (memory 1 1) (data $d ${pattern})\n  (func (export "t") (result i64) ${b.body} (i64.const 0)))\n`,
      m: { kind: 'failure', feature: 'bulkMemory', covers: [b.op], expect: 'trap' },
    });
  }
  return out;
}

// ---- encoding ----

const ENCODINGS = [
  {
    id: 'mutable-global-export',
    feature: 'mutableGlobals',
    expect: '2a',
    wat:
      '(module\n  (global $g (export "g") (mut i64) (i64.const 41))\n  (func (export "t") (result i64)\n    global.get $g i64.const 1 i64.add global.set $g global.get $g))\n',
  },
  {
    id: 'branch-hint',
    feature: 'codeMetadata',
    expect: '7',
    wat:
      '(module\n  (func (export "t") (result i64)\n    (local i32)\n    i32.const 1\n    local.set 0\n    (@metadata.code.branch_hint "\\01")\n    (if (result i64) (local.get 0)\n      (then i64.const 7)\n      (else i64.const 9))))\n',
  },
];

/**
 * Writes every probe module to `<out>/wat` and `<out>/wasm` and `<out>/index.json`. Returns the index
 * and the PROBLEMS: a module that did not assemble or validate, or a template whose bytes lack an
 * instruction it claims to cover. A problem fails the probe: a module missing is a measurement missing.
 */
export function buildModules(out: string): { index: ProbeModule[]; problems: string[] } {
  mkdirSync(`${out}/wat`, { recursive: true });
  mkdirSync(`${out}/wasm`, { recursive: true });
  const all: { id: string; wat: string; legacy?: true; m: Omit<ProbeModule, 'file'> }[] = [
    ...typed(),
    ...templates(),
    ...failures(),
    ...ENCODINGS.map((x) => ({
      id: `enc-${x.id}`,
      wat: x.wat,
      m: { kind: 'encoding' as const, feature: x.feature, covers: [], expect: x.expect },
    })),
  ];
  const index: ProbeModule[] = [];
  const problems: string[] = [];
  const last = (s: string) => s.trim().split('\n').slice(-1)[0] ?? '';
  for (const x of all) {
    const wat = `${out}/wat/${x.id}.wat`;
    const wasm = `${out}/wasm/${x.id}.wasm`;
    writeFileSync(wat, x.wat);
    const asm = x.legacy
      ? spawnSync('wat2wasm', ['--enable-all', wat, '-o', wasm], { encoding: 'utf8' })
      : spawnSync('wasm-tools', ['parse', wat, '-o', wasm], { encoding: 'utf8' });
    if (asm.status !== 0) {
      problems.push(`${x.id}: assembly: ${last(asm.stderr || asm.stdout || String(asm.error))}`);
      continue;
    }
    const v = spawnSync('wasm-tools', ['validate', '--features=all', wasm], { encoding: 'utf8' });
    if (v.status !== 0) {
      problems.push(`${x.id}: invalid: ${last(v.stderr)}`);
      continue;
    }
    if (x.m.kind === 'template') {
      // The instruction must really be in the bytes: print the binary back and look for each mnemonic.
      const printed = spawnSync('wasm-tools', ['print', wasm], { encoding: 'utf8' }).stdout;
      const missing = x.m.covers.filter((c) =>
        !new RegExp(`(^|[\\s(])${c.split(' ')[0]!.replace(/\./g, '\\.')}(\\s|\\)|$)`, 'm').test(
          printed,
        )
      );
      if (missing.length) problems.push(`${x.id}: not in the bytes: ${missing.join(', ')}`);
    }
    index.push({ file: `${x.id}.wasm`, ...x.m });
  }
  // Every D1 entry must be exercised by some module, or the probe does not measure it.
  const covered = new Set(index.flatMap((m) => m.covers));
  const uncovered = D1.filter((e) => !covered.has(e.name) && e.name !== 'end' && e.name !== 'else')
    .map((e) => e.name);
  for (const n of uncovered) problems.push(`${n}: no probe module exercises it`);
  writeFileSync(`${out}/index.json`, `${JSON.stringify(index, null, 1)}\n`);
  return { index, problems };
}
