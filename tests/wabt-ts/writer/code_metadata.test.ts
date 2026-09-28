// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// W8 (cmem/divergences.md): `(@metadata.code.NAME "data")` — a code-metadata
// hint on the next instruction, which `wat2wasm` writes as a
// `metadata.code.NAME` custom section.
//
// 🔧 The lexer skipped it like any unknown annotation, and the binary writer's
// `onCodeMetadataExpr` was a no-op besides: every hint vanished, and `wat2wasm`
// reported success. Now it is lexed, parsed as a statement in the instruction
// list, and written the way upstream writes it. Every expected payload below
// is upstream `wat2wasm --enable-annotations --enable-code-metadata`'s (1.0.41)
// on the very same text: `vec(func_idx, vec(offset, len, data))`, sections by
// first appearance of the name, IMMEDIATELY before the code section, offsets
// from the start of the body (after its size, so counting the locals).

import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';

import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { readWat } from '../../../src/binaryen-ts/tools/read-wat.ts';
import { writeWasm, writeWat } from '../../../src/binaryen-ts/encoder/write-wasm.ts';

/** Known sections by id, custom sections as `"name"=<payload hex>`. */
function layout(b: Uint8Array): string {
  const out: string[] = [];
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 0) {
      const n = b[i]!;
      const name = new TextDecoder().decode(b.subarray(i + 1, i + 1 + n));
      const payload = [...b.subarray(i + 1 + n, i + size)]
        .map((x) => x.toString(16).padStart(2, '0')).join('');
      // What a writer adds beyond upstream's, not what is under test.
      if (name !== 'name' && name !== 'binaryang.text-form') out.push(`"${name}"=${payload}`);
    } else out.push(String(id));
    i += size;
  }
  return out.join(' ');
}

/** The code section, id and size included. */
function codeSection(b: Uint8Array): string {
  for (let i = 8; i < b.length;) {
    const at = i;
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    i += size;
    if (id === 10) {
      return [...b.subarray(at, i)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
  }
  throw new Error('no code section');
}

function assemble(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  return r.binary;
}

function refused(wat: string): string {
  const r = wat2wasm(wat);
  assert(hasErrors(r.errors), 'refused');
  return formatErrors(r.errors);
}

/**
 * A hint between an operand and its consumer (`local.get 0 (@…) if`) points at
 * the `if`, not at the `local.get` a folded tree writes first; one in a folded
 * block body; one on an OPERAND (`local.get` under `br_if`); a function with
 * none between two with some.
 */
const BRANCHES = `(module
  (func $a (param i32) (result i32)
    local.get 0
    (@metadata.code.branch_hint "\\01")
    if (result i32)
      i32.const 1
    else
      (@metadata.code.branch_hint "\\00")
      i32.const 2
    end)
  (func $b nop)
  (func $c (param i32)
    (@metadata.code.test "abc")
    block
      (@metadata.code.branch_hint "\\00")
      local.get 0
      br_if 0
    end))`;
const BRANCHES_LAYOUT = '1 3 "metadata.code.branch_hint"=020002030101080100020103010' +
  '0 "metadata.code.test"=0102010103616263 10';

/**
 * Names in order of FIRST appearance (zzz before aaa); two hints on one
 * instruction; an empty payload; a hint in a folded block; one at the END of
 * a body, which points at its `end`.
 */
const NAMES = `(module
  (func $a
    (@metadata.code.zzz "z")
    nop
    (@metadata.code.aaa "a1\\02")
    nop
    (@metadata.code.zzz "y")
    (@metadata.code.aaa "b")
    nop)
  (func $b (@metadata.code.mmm "") nop)
  (func $c (param i32)
    (@metadata.code.zzz "c")
    (block (@metadata.code.aaa "d") (br_if 0 (local.get 0))))
  (func $d (@metadata.code.aaa "e")))`;
// ONE entry is not upstream wabt's: `(block (@metadata.code.aaa "d") (br_if 0
// (local.get 0)))` annotates the FOLDED `br_if`, whose own opcode is at 5 — the
// `local.get` it folds around comes first, at 3. Upstream wabt 1.0.41 writes 3
// (the expression's first byte); wasm-tools writes 5 (measured 2026-09-28 on a
// branch_hint of this shape), and branch-hint validation needs it. The `…0105…`
// below was `…0103…` (divergence W16).
const NAMES_LAYOUT = '1 3 "metadata.code.zzz"=02000201017a0301790201010163 ' +
  '"metadata.code.aaa"=030002020361310203016202010501640301010165 ' +
  '"metadata.code.mmm"=0101010100 10';

/**
 * The function INDEX counts the imports (2, not 0), and an offset counts the
 * local declarations (7: `02 02 7e 01 7d` and `10 00` come first).
 */
const IMPORTS = `(module
  (import "env" "g" (func $g))
  (import "env" "h" (func $h))
  (func $f (local i64 i64 f32)
    call $g
    (@metadata.code.inline "\\7f")
    call $h))`;
const IMPORTS_LAYOUT = '1 2 3 "metadata.code.inline"=01020107017f 10';

Deno.test('wat2wasm writes each hint as upstream does (a folded one: as wasm-tools)', () => {
  assertEquals(layout(assemble(BRANCHES)), BRANCHES_LAYOUT);
  assertEquals(layout(assemble(NAMES)), NAMES_LAYOUT);
  assertEquals(layout(assemble(IMPORTS)), IMPORTS_LAYOUT);
});

Deno.test('the code section is unchanged by the hints it carries', () => {
  const plain = (wat: string) => wat.replace(/\(@metadata\.code\.\w+ "[^"]*"\)/g, '');
  for (const wat of [BRANCHES, NAMES]) {
    assert(plain(wat) !== wat);
    assertEquals(codeSection(assemble(wat)), codeSection(assemble(plain(wat))));
  }
});

Deno.test('the one writer writes them too, and writeWat prints them back', () => {
  for (const [wat, want] of [[BRANCHES, BRANCHES_LAYOUT], [NAMES, NAMES_LAYOUT]] as const) {
    assertEquals(layout(writeWasm(readWat(wat))), want);
    // `readWat` reads through the bytes, where a hint is its section: the
    // text prints it as `(@custom "metadata.code.…" …)`, at its place.
    const text = writeWat(readWat(wat));
    assertEquals(layout(assemble(text)), want, 'the text assembles to the same sections');
  }
});

// The bytes cannot see this: they are written in binary order either way. A
// hint left on the OPERAND stack became `i32.add`'s left operand, with
// `i32.const 1` a statement of its own — a tree no pass or validator reads right.
Deno.test('a hint is parsed as a statement, never as an operand', () => {
  const r = parseWatModule(`(module (func (result i32)
    i32.const 1
    (@metadata.code.x "")
    i32.const 2
    i32.add))`);
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  const body = r.module.functions[0]!.body.children;
  assertEquals(body.map((e) => e.kind), ['const', 'code_metadata', 'binary']);
  const add = body[2]!;
  assert(add.kind === 'binary');
  assertEquals([add.left.kind, add.right.kind], ['pop', 'const']);
});

Deno.test('exactly one string, as upstream reads it', () => {
  assertStringIncludes(
    refused('(module (func (@metadata.code.x "a" "b") nop))'),
    'expected )',
  );
  assertStringIncludes(refused('(module (func (@metadata.code.x) nop))'), 'expected');
});

Deno.test('a hint is an instruction-list item, not a module field', () => {
  refused('(module (@metadata.code.x "") (func))');
});

Deno.test('a hint beside a raw section of the same name is refused, not doubled', () => {
  assertThrows(
    () => assemble(`(module (@custom "metadata.code.x" "\\00") (func (@metadata.code.x "") nop))`),
    Error,
    'both a custom section and code-metadata annotations',
  );
});
