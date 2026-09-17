// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// A `try_table` catch clause is TWO BITS: `tag` present or absent, and `isRef`.
//
// 🔧 History. It was `{ kind: CatchKind; tag?: Var; target: Var }`, where `kind`
// and the presence of `tag` are the same fact — and the binary writer read them
// separately, so a `catch_all` carrying a tag emitted the `catch_all` byte
// FOLLOWED by a stray tag index, sliding every later clause by one field.
// `b1410d6e8` closed that by splitting the record into a union keyed by `kind`.
//
// S6 step 5, stage (b), closed it the other way: there is no `kind` at all.
// `tag` × `isRef` is exactly the four clauses, so nothing is left that could
// disagree — the legacy `Catch` has always held them this way, and binaryen-ts's
// clause too. Chosen by trial: converting wabt-ts cost 6 source sites,
// converting binaryen-ts 9, and meaning agreed. Both IRs then took wabt-ts's
// (and upstream wabt's) NAMES for the pair, `Catch` / `TableCatch` — binaryen-ts
// had `TryCatch` / `CatchClause`; renaming its side cost 13 errors against 17.
//
// ⚠️ The pins at the bottom are checked by `deno task check`, not by the test
// run: re-adding a `kind` (or any field) to either record fails the GATE.
// The runtime half pins the MAPPING, which type-checks whichever way it is
// wired: every clause through the parser, the binary writer, the binary reader
// and the text writer.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import type { Catch, Expr, TableCatch } from '../../../src/wabt-ts/ir/ir.ts';
import type {
  Catch as BCatch,
  TableCatch as BTableCatch,
} from '../../../src/binaryen-ts/ir/expressions.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/wabt-ts/tools/wasm2wat.ts';
import { formatErrors, hasErrors } from '../../../src/wabt-ts/core/error.ts';

type TryTable = Extract<Expr, { kind: 'try_table' }>;

/** The first `try_table` under `root`, however deeply nested (a `drop`, a `block`, …). */
function tryTableOf(root: unknown): TryTable {
  const stack = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if ((v as { kind?: unknown }).kind === 'try_table') return v as TryTable;
    stack.push(...Object.values(v));
  }
  throw new Error('no try_table');
}

function compile(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  if (hasErrors(r.errors)) throw new Error(formatErrors(r.errors));
  assert(r.binary);
  return r.binary;
}

/** The code section's payload, as hex bytes. */
function codeOf(b: Uint8Array): string {
  for (let i = 8; i < b.length;) {
    const id = b[i++]!;
    let size = 0;
    for (let s = 0;; s += 7) {
      const x = b[i++]!;
      size += (x & 0x7f) * 2 ** s;
      if ((x & 0x80) === 0) break;
    }
    if (id === 10) {
      return [...b.subarray(i, i + size)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    }
    i += size;
  }
  return '(none)';
}

// The kind byte, then a tag index only for the TAGGED pair, then the label:
// catch 0x00, catch_ref 0x01, catch_all 0x02, catch_all_ref 0x03. The `_ref`
// variants hand the handler an `exnref`, so their target block takes one — which
// also makes the VALIDATOR's half of the mapping observable: a swapped `isRef`
// sends a value the label does not take, and `wat2wasm` refuses the module.
const CLAUSES = [
  {
    name: 'catch',
    wat: '(module (tag $e) (func (block $h (try_table (catch $e $h) (nop)))))',
    bytes: '1f 40 01 00 00 00',
    tagged: true,
    isRef: false,
  },
  {
    name: 'catch_ref',
    wat: '(module (tag $e) (func (block $h (result exnref)' +
      ' (try_table (catch_ref $e $h) (nop)) (unreachable)) (drop)))',
    bytes: '1f 40 01 01 00 00',
    tagged: true,
    isRef: true,
  },
  {
    name: 'catch_all',
    wat: '(module (tag $e) (func (block $h (try_table (catch_all $h) (nop)))))',
    bytes: '1f 40 01 02 00',
    tagged: false,
    isRef: false,
  },
  {
    name: 'catch_all_ref',
    wat: '(module (tag $e) (func (block $h (result exnref)' +
      ' (try_table (catch_all_ref $h) (nop)) (unreachable)) (drop)))',
    bytes: '1f 40 01 03 00',
    tagged: false,
    isRef: true,
  },
] as const;

function shapeOf(c: TableCatch): { tagged: boolean; isRef: boolean } {
  return { tagged: c.tag !== undefined, isRef: c.isRef };
}

describe('each try_table catch clause is its two bits, on every path', () => {
  for (const c of CLAUSES) {
    const expected = { tagged: c.tagged, isRef: c.isRef };

    it(`${c.name}: the text parser`, () => {
      const { module, errors } = parseWatModule(c.wat);
      assert(!hasErrors(errors), formatErrors(errors));
      const [clause] = tryTableOf(module.functions[0]!.body.children).catches;
      assertEquals(shapeOf(clause!), expected);
    });

    it(`${c.name}: the binary writer (and the validator accepts it)`, () => {
      const code = codeOf(compile(c.wat));
      assert(code.includes(c.bytes), `expected ${c.bytes} in ${code}`);
    });

    it(`${c.name}: the binary reader`, () => {
      const errors = makeErrorList();
      const module = readBinaryIr(compile(c.wat), errors);
      assert(!hasErrors(errors), formatErrors(errors));
      const [clause] = tryTableOf(module.functions[0]!.body.children).catches;
      assertEquals(shapeOf(clause!), expected);
    });

    it(`${c.name}: the text writer`, () => {
      const text = wasm2wat(compile(c.wat)).text!;
      assert(new RegExp(`\\(${c.name} `).test(text), text);
    });
  }
});

// ---------------------------------------------------------------------------
// Compile-time pins — `deno task check`
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** The clause's whole field set: no `kind` beside the tag. */
const _twoBits: Same<keyof TableCatch, 'loc' | 'tag' | 'target' | 'isRef'> = true;

/** And it is binaryen-ts's record, `loc` aside (the node-base stage). */
const _oneClauseRecord: [
  Same<keyof Omit<TableCatch, 'loc'>, keyof BTableCatch>,
  Same<Omit<TableCatch, 'loc'>, BTableCatch>,
] = [true, true];

/**
 * The legacy record agrees on every field but `body` (`Expr[]` against
 * `RegionExpr`, sub-stage (d)) and `loc` — pinned so (d) has to re-pin it.
 */
const _legacyAllButBody: [
  Same<keyof Catch, keyof BCatch | 'loc'>,
  Same<Omit<Catch, 'loc' | 'body'>, Omit<BCatch, 'body'>>,
] = [true, true];

void _twoBits;
void _oneClauseRecord;
void _legacyAllButBody;
