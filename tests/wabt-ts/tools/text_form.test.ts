// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S7 — the text-form record: `wat2wasm` → `wasm2wat` gives back the form each
// INSTRUCTION was written in. Owner, 2026-09-19: "The first rule is fidelity
// for the wat2wasm and wasm2wat… this part transpiles verbatim", and "The
// default should be a mixed form if a mixed form is in the wat… It should
// never change the state unless it goes into optimization."
//
// `wat2wasm` records how each instruction was written — bare, or folded around
// how many items — in a trailing custom section, `binaryang.text-form`
// (`src/wabt-ts/ir/text-form.ts`), keeping only what the wabt-ts reader would
// not predict; every reader turns it back into as-written metadata; `wasm2wat`
// rebuilds the grouping from it; the optimizer drops it with the rest of that
// metadata.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotEquals } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { wasmStrip } from '../../../src/wabt-ts/tools/wasm-strip.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../../../src/binaryen-ts/encoder/write-wasm.ts';
import { PassRunner } from '../../../src/binaryen-ts/passes/index.ts';
import {
  decodeTextForm,
  formNodes,
  predictionHash,
  TEXT_FORM_SECTION,
  writtenForms,
} from '../../../src/wabt-ts/ir/text-form.ts';

const MIXED_FILE = `(module
  (import "env" "log" (func $log (param i32)))
  (func $lin (export "lin") (param i32) (result i32)
    local.get 0
    i32.const 1
    i32.add)
  (func $fold (export "fold") (param i32) (result i32)
    (i32.mul (local.get 0) (i32.const 2)))
  (func $both (export "both") (param i32) (result i32)
    local.get 0
    (i32.const 3)
    i32.sub)
  (func $siblings (export "siblings") (result i32)
    (i32.const 1) (i32.const 2) (i32.add))
  (func $partial (export "partial") (param i32) (result i32)
    (local.get 0)
    (i32.sub (i32.const 10)))
  (func $nested (export "nested") (param i32) (result i32)
    block (result i32)
      (i32.add (local.get 0) (i32.const 1))
    end
    (if (result i32) (i32.eqz (local.get 0))
      (then i32.const 5)
      (else (i32.const 6)))
    i32.add))`;

function asm(wat: string, opts: { textForm?: boolean } = {}): Uint8Array {
  const r = wat2wasm(wat, opts);
  assert(r.binary.length > 0 && WebAssembly.validate(r.binary as BufferSource), 'valid');
  return r.binary;
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The payload of the LAST section, if it is the text-form record. */
function trailingRecord(b: Uint8Array): Uint8Array | null {
  let p = 8, last: Uint8Array | null = null;
  while (p < b.length) {
    const id = b[p++]!;
    let size = 0, shift = 0, byte;
    do {
      byte = b[p++]!;
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    const end = p + size;
    last = null;
    if (id === 0) {
      const n = b[p]!;
      const name = new TextDecoder().decode(b.slice(p + 1, p + 1 + n));
      if (name === TEXT_FORM_SECTION) last = b.slice(p + 1 + n, end);
    }
    p = end;
  }
  return last;
}

/** Every function's forms as the parser reads them from `wat`, in binary order. */
function formsOf(wat: string): number[][] {
  const m = parseWatModule(wat).module!;
  return m.functions.map((f) => [...(writtenForms(m, f) ?? formNodes(f.body.children).canonical)]);
}

/** The text of function `name` in `text`, up to the next function. */
function bodyOf(text: string, name: string): string {
  const start = text.indexOf(`(func ${name}`);
  assert(start >= 0, `no ${name}:\n${text}`);
  const next = text.indexOf('(func ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

/** `text`'s tokens with whitespace collapsed — layout aside, what was written. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('S7 — wat2wasm → wasm2wat keeps every instruction’s form', () => {
  const text = wasm2wat(asm(MIXED_FILE)).text;

  it('linear stays linear, folded stays folded', () => {
    assert(/\n\s+local\.get 0\n\s+i32\.const 1\n\s+i32\.add\)/.test(bodyOf(text, '$lin')), text);
    assert(flat(bodyOf(text, '$fold')).includes('(i32.mul (local.get 0) (i32.const 2))'), text);
  });

  it('a mix stays the same mix — bare, folded, bare', () => {
    assert(flat(bodyOf(text, '$both')).includes('local.get 0 (i32.const 3) i32.sub)'), text);
  });

  it('folded siblings stay siblings, a partial fold stays partial', () => {
    assert(
      flat(bodyOf(text, '$siblings')).includes('(i32.const 1) (i32.const 2) (i32.add))'),
      text,
    );
    // `(i32.sub (i32.const 10))` takes its first operand from the stack.
    assert(
      flat(bodyOf(text, '$partial')).includes('(local.get 0) (i32.sub (i32.const 10)))'),
      text,
    );
  });

  it('forms nest through control: a bare block around a fold, a bare arm in a folded if', () => {
    const body = flat(bodyOf(text, '$nested'));
    assert(
      body.includes('block (result i32) ;; label = @1 (i32.add (local.get 0) (i32.const 1)) end'),
      body,
    );
    // The condition is written INSIDE the folded if, as in the source.
    assert(body.includes('(if (result i32) (i32.eqz (local.get 0)) (then'), body);
    assert(body.includes('(then i32.const 5) (else (i32.const 6))) i32.add)'), body);
  });

  it('every instruction’s form, as the parser reads it, comes back', () => {
    assertEquals(formsOf(text), formsOf(MIXED_FILE));
  });

  it('the round trip is a byte and a text fixed point, and runs the same', () => {
    const bytes = asm(MIXED_FILE);
    const again = asm(text);
    assert(eq(again, bytes));
    assertEquals(wasm2wat(again).text, text);
    const x = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), {
      env: { log: () => {} },
    }).exports as Record<string, (i?: number) => number>;
    assertEquals([x.lin!(4), x.both!(4), x.siblings!(), x.partial!(4), x.nested!(0)], [
      5,
      1,
      3,
      -6,
      6,
    ]);
  });

  // A VOID call written inside another call's parens is legal grouping — it
  // runs first — and the parser's tree makes it an operand, so to the parser
  // this function IS the plain nested fold. The wabt-ts reader follows the
  // values instead: the void call is a statement, and it would print it as a
  // sibling. The record is written against the READER's prediction, so the
  // form survives the trees disagreeing (found in the wasmtk corpus).
  it('a form the reader would predict differently is recorded, and comes back', () => {
    const src = `(module
      (global $a (mut i32) (i32.const 0))
      (func $set (param i32) (global.set $a (local.get 0)))
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (result i32)
        (call $add (call $set (i32.const 5)) (global.get $a) (i32.const 1))))`;
    // The premise: the parser sees nothing to record, the reader does.
    const m = parseWatModule(src).module!;
    const f = m.functions[2]!;
    assertEquals(writtenForms(m, f), formNodes(f.body.children).canonical);
    const entries = decodeTextForm(trailingRecord(asm(src))!)!;
    assertEquals(entries.map((e) => e.index), [2]);

    const back = wasm2wat(asm(src)).text;
    assertEquals(formsOf(back), formsOf(src));
    const predicted = wasm2wat(asm(src, { textForm: false })).text;
    assertNotEquals(formsOf(predicted), formsOf(src), 'without the record it would move');
  });
});

describe('S7 — the section', () => {
  it('last; version 2; only what the reader would not predict', () => {
    // $log is import 0. $lin (1): base 1 (every instruction bare), 3
    // instructions, no exceptions. $fold (2) is the plain nested fold, so not
    // written. $both (3): bare base, one exception — position 1 folded (form 1).
    const entries = decodeTextForm(trailingRecord(asm(MIXED_FILE))!)!;
    assertEquals(entries.map((e) => e.index), [1, 3, 4, 5, 6]);
    assertEquals(entries[0], { index: 1, linearBase: true, instructions: 3, exceptions: [] });
    assertEquals(entries[1], { index: 3, linearBase: true, instructions: 3, exceptions: [[1, 1]] });
    // $siblings (4): the predicted base — the add was written around NO items.
    assertEquals(entries[2]!.linearBase, false);
    assertEquals(entries[2]!.exceptions, [[2, 1]]);
  });

  it('a module written as the plain nested fold carries no section at all', () => {
    // The second function's `drop` takes the block's entry value — an operand
    // that is a `pop`, which the plain nested fold writes as nothing.
    const folded = `(module
      (func (export "f") (result i32) (i32.add (i32.const 1) (i32.const 2)))
      (func (export "g") (i32.const 1) (block (param i32) (drop))))`;
    assertEquals(trailingRecord(asm(folded)), null);
    assert(eq(asm(folded), asm(folded, { textForm: false })));
  });

  it('`textForm: false` gives the same bytes without the section — upstream wat2wasm’s', () => {
    const on = asm(MIXED_FILE), off = asm(MIXED_FILE, { textForm: false });
    assertEquals(trailingRecord(off), null);
    assert(
      on.length > off.length && eq(on.slice(0, off.length), off),
      'a trailing section, nothing else',
    );
  });
});

describe('S7 — naming a form forces it', () => {
  const bytes = asm(MIXED_FILE);

  it('`fold: true` folds every function, `fold: false` writes every one flat', () => {
    assert(flat(bodyOf(wasm2wat(bytes, { fold: true }).text, '$lin')).includes('(i32.add'));
    const linear = wasm2wat(bytes, { fold: false }).text;
    assert(!linear.includes('(i32.'), linear);
  });

  it('`asWritten: false` lets `fold` decide', () => {
    assertEquals(wasm2wat(bytes, { asWritten: false }).text, wasm2wat(bytes, { fold: true }).text);
  });

  it('every forced form assembles to the same code', () => {
    const code = (wat: string) => wat2wasm(wat, { textForm: false }).binary;
    for (const fold of [true, false]) {
      assertEquals(code(wasm2wat(bytes, { fold }).text), code(MIXED_FILE), `fold: ${fold}`);
    }
  });
});

describe('S7 — binaryen-ts: kept without passes, dropped by the optimizer', () => {
  it('decode → encode keeps it', () => {
    const bytes = asm(MIXED_FILE);
    assert(eq(writeWasm(readForPasses(bytes)), bytes));
  });

  // The section is predicted from the wabt-ts READER's tree, and binaryen-ts's
  // decoder predicts with that reader rather than with its own tree.
  //
  // 🔧 This fixture was written when the two trees DID disagree here — the
  // reader popped operand NODES, so a multi-value operand took the call's
  // neighbour. They agree everywhere in the corpus since the reader pops
  // VALUES (One front end, stage 2), so the disagreement can no longer be
  // staged; what the guard does when a tree disagrees is covered by
  // "an entry that does not match its tree is skipped" below.
  it('decode → encode keeps a record for a multi-value tree', () => {
    // The consumer is written LINEARLY, so it has a record to keep; its tree is
    // the multi-value one (`$pair` fills two of `$add2`'s three operand slots).
    const src = `(module
      (func $pair (result i32 i32) (i32.const 1) (i32.const 2))
      (func $take2 (param i32 i32) (result i32) (i32.sub (local.get 0) (local.get 1)))
      (func $add2 (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func (export "f") (param i32) (result i32)
        local.get 0
        call $pair
        call $take2
        call $add2))`;
    const bytes = asm(src);
    // The premise: the two trees agree on the prediction, and the record is
    // there to be kept.
    const plain = asm(src, { textForm: false });
    const reader = readBinaryIr(plain, makeErrorList()).functions[3]!;
    const decoded = readForPasses(plain).functions[3]!;
    assertEquals(
      formNodes(decoded.body.children).canonical,
      formNodes(reader.body.children).canonical,
    );
    assertEquals(decodeTextForm(trailingRecord(bytes)!)!.map((e) => e.index), [3]);

    assert(eq(writeWasm(readForPasses(bytes)), bytes));
  });

  it('an optimized module carries none', () => {
    const m = readForPasses(asm(MIXED_FILE));
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses().run();
    assertEquals(trailingRecord(writeWasm(m)), null);
  });
});

/** MIXED_FILE's bytes with the record's payload replaced by `payload`. */
function withPayload(payload: readonly number[]): Uint8Array {
  const off = asm(MIXED_FILE, { textForm: false });
  const name = new TextEncoder().encode(TEXT_FORM_SECTION);
  const body = [name.length, ...name, ...payload];
  return new Uint8Array([...off, 0, body.length, ...body]);
}

describe('S7 — a record that does not fit is kept raw and ignored', () => {
  for (
    const [what, payload] of [
      ['version 1 (never released)', [1, 1, 1]],
      ['an unknown version', [3, 0]],
      ['an imported function', [2, 1, 0, 1, 3, 0]],
      ['an index past the module', [2, 1, 9, 1, 3, 0]],
      ['indices not ascending', [2, 2, 3, 1, 3, 0, 1, 1, 3, 0]],
      ['a base that is neither 0 nor 1', [2, 1, 1, 2, 3, 0]],
      ['an exception past the body', [2, 1, 1, 1, 3, 1, 3, 1]],
      ['a trailing byte', [2, 1, 1, 1, 3, 0, 0]],
      ['a truncated hash', [2, 1, 1, 0, 3, 7]],
    ] as const
  ) {
    it(`${what}: output as predicted, and the bytes round-trip`, () => {
      const bytes = withPayload(payload);
      const text = wasm2wat(bytes).text;
      assert(bodyOf(text, '$lin').includes('(i32.add'), `ignored → predicted:\n${text}`);
      // Kept as raw bytes: every reader, every writer, same bytes back.
      assert(eq(writeWasm(readForPasses(bytes)), bytes), 'binaryen-ts keeps it raw');
      assert(text.includes(`(@custom "${TEXT_FORM_SECTION}"`), 'wabt-ts keeps it raw');
    });
  }
});

// A well-formed entry that does not match the tree reading it — another count,
// another prediction — is SKIPPED, not misapplied: that function prints as
// predicted, the others as recorded, and the section is consumed.
/** A 4-byte little-endian hash, as the section carries it. */
const le32 = (h: number) => [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, h >>> 24];

// $lin's predicted forms: `(i32.add (local.get 0) (i32.const 1))`.
const LIN_PREDICTED = [1, 1, 3];

describe('S7 — an entry that does not match its tree is skipped', () => {
  // Each entry, APPLIED, would give $lin a valid grouping other than the
  // predicted one — so only the check being tested stands between it and the
  // output.
  for (
    const [what, entry] of [
      ['another instruction count', [1, 1, 4, 0]],
      // Against a prediction whose hash is not this tree's: the add written
      // around no items, `(local.get 0) (i32.const 1) (i32.add)`.
      ['another prediction', [1, 0, 3, ...le32(predictionHash([1, 1, 2])), 1, 2, 1]],
    ] as const
  ) {
    it(`${what}: predicted, not grouped wrongly`, () => {
      // $lin's entry as given; $both's as wat2wasm writes it (bare, one fold).
      const text = wasm2wat(withPayload([2, 2, ...entry, 3, 1, 3, 1, 1, 1])).text;
      assert(flat(bodyOf(text, '$lin')).includes('(i32.add (local.get 0) (i32.const 1))'), text);
      assert(flat(bodyOf(text, '$both')).includes('local.get 0 (i32.const 3) i32.sub)'), text);
      assert(!text.includes('(@custom'), 'consumed, not kept raw');
    });
  }

  // The hash matches, but the forms cannot be written: the add folded around
  // two items when the first is BARE — `(i32.add local.get 0 …)` is not WAT.
  // The function prints as predicted, and the output assembles.
  it('forms that do not group: predicted, and the text assembles', () => {
    const entry = [1, 0, 3, ...le32(predictionHash(LIN_PREDICTED)), 1, 0, 0];
    const text = wasm2wat(withPayload([2, 1, ...entry])).text;
    assert(flat(bodyOf(text, '$lin')).includes('(i32.add (local.get 0) (i32.const 1))'), text);
    assert(wat2wasm(text).binary.length > 0, text);
  });
});

describe('S7 — wasm-strip', () => {
  it('stripping everything drops the record', () => {
    const stripped = wasmStrip(asm(MIXED_FILE)).binary;
    assertEquals(trailingRecord(stripped), null);
    assert(
      bodyOf(wasm2wat(stripped).text, '(;1;)').includes('(i32.add'),
      'predicted once stripped',
    );
  });

  it('stripping another section keeps it; naming it drops it', () => {
    const bytes = asm(MIXED_FILE);
    assertNotEquals(trailingRecord(wasmStrip(bytes, { sections: ['name'] }).binary), null);
    assertEquals(trailingRecord(wasmStrip(bytes, { sections: [TEXT_FORM_SECTION] }).binary), null);
  });
});
