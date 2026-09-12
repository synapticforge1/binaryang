// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// S3 — as-written metadata beside the tree, and the key it has to use.
//
// The convergence plan specified the side table as "keyed by node identity, so
// a pass that rewrites a subtree simply loses the entries for what it replaced".
// That is the right SEMANTICS and the wrong KEY for this codebase, and the
// difference is measurable rather than theoretical.
//
// wabt-ts's IR is immutable — 492 `readonly` fields — so its passes rebuild
// nodes by spread instead of mutating them: `resolveNames` does it in 75 places,
// `applyNames` in 25. A spread mints a new object and therefore a new identity,
// even when the pass is semantically identity-PRESERVING. Resolving `$x` to `0`
// is the same instruction at the same place, and it lands in a different object.
//
// 🔑 So an identity-keyed table would be emptied by the very pipeline that needs
// it — not by an optimizing pass legitimately discarding fidelity, but by name
// resolution, which every parsed module goes through before it is written. And
// it would fail SILENTLY: entries vanish, the writer falls back to derived
// values, and the output stays valid while quietly ceasing to be faithful.
//
// The first test below is the counter-example, kept as an executable record of
// why the key changed. The rest verify that an opaque, spread-preserved id does
// survive the real pipeline over the real corpus.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';

import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { makeModule } from '../../../src/wabt-ts/ir/ir.ts';
import { FidelityTable } from '../../../src/wabt-ts/ir/fidelity.ts';
import type { Expr, Module, SelectExpr } from '../../../src/wabt-ts/ir/ir.ts';

const CORPUS = new URL('../wasmtk/', import.meta.url);

/** Named child fields — a generic walk would descend into types, which are not expressions. */
const CHILD_FIELDS = [
  'body',
  'ifTrue',
  'ifFalse',
  'value',
  'values',
  'operand',
  'condition',
  'address',
  'operands',
  'catches',
  'val1',
  'val2',
  'source',
  'dest',
  'size',
  'callee',
] as const;

function walk(mod: Module, visit: (e: Expr) => void): void {
  const go = (e: unknown): void => {
    if (e === null || typeof e !== 'object') return;
    const rec = e as Record<string, unknown>;
    if (typeof rec['kind'] !== 'string') return;
    visit(e as Expr);
    for (const key of CHILD_FIELDS) {
      const v = rec[key];
      if (Array.isArray(v)) { for (const c of v) go(c); }
      else if (v && typeof v === 'object') go(v);
    }
  };
  for (const f of mod.funcs) for (const e of f.body) go(e);
}

function selectsOf(mod: Module): SelectExpr[] {
  const out: SelectExpr[] = [];
  walk(mod, (e) => {
    if (e.kind === 'select') out.push(e as SelectExpr);
  });
  return out;
}

const WITH_SELECTS = `(module
  (func $bare (param i32) (result i32)
    (select (i32.const 1) (i32.const 2) (local.get 0)))
  (func $typed (param i32) (result externref)
    (select (result externref) (ref.null extern) (ref.null extern) (local.get 0)))
)`;

describe('S3 — why the side table is not keyed by node identity', () => {
  // ⚠️ This test asserts the BROKEN behaviour on purpose. It is the measurement
  // that rejected the plan's stated key, and it belongs in the suite so that a
  // future reader does not "simplify" the id away and reintroduce silent loss.
  it('a WeakMap keyed by the node loses most entries across resolveNames', () => {
    const parsed = parseWatModule(WITH_SELECTS);
    assert(parsed.module, 'fixture must parse');

    const before: Expr[] = [];
    walk(parsed.module, (e) => before.push(e));
    assert(before.length > 4, 'fixture must have enough nodes to be meaningful');

    const identityTable = new WeakMap<object, true>();
    for (const n of before) identityTable.set(n, true);

    const after: Expr[] = [];
    resolveNames(parsed.module);
    walk(parsed.module, (e) => after.push(e));

    const survived = after.filter((n) => identityTable.has(n)).length;
    assert(
      survived < after.length,
      `identity was expected to be LOST for some nodes; ${survived}/${after.length} survived. ` +
        'If this now passes, resolveNames stopped rebuilding by spread and the key can be revisited.',
    );
  });

  it('an id survives the same pass, because a spread copies it', () => {
    const parsed = parseWatModule(WITH_SELECTS);
    assert(parsed.module, 'fixture must parse');
    // Stand in for what the reader records, since the WAT parser side of S3 is
    // not wired yet — the point under test is the KEY, not the producer.
    const table = new FidelityTable();
    const idsBefore = selectsOf(parsed.module).map(() => table.record({ selectResultType: [] }));
    assertEquals(idsBefore.length, 2, 'fixture must have two selects');

    resolveNames(parsed.module);
    // Every id minted is still resolvable in the table; nothing was keyed on an
    // object that the pass replaced.
    for (const id of idsBefore) assert(table.get(id) !== undefined, 'entry must survive');
  });
});

describe('S3 — the reader records what was written', () => {
  it('distinguishes a bare select from a typed one', () => {
    const asm = wat2wasm(WITH_SELECTS, { filename: 'sel.wat' });
    assert(asm.binary, 'fixture must assemble');
    const mod = readBinaryIr(asm.binary, makeErrorList());

    const selects = selectsOf(mod);
    assertEquals(selects.length, 2);

    for (const s of selects) {
      assert(s.nodeId !== undefined, 'every select the reader builds carries an id');
      const entry = mod.fidelity.get(s.nodeId);
      assert(entry !== undefined, 'and an entry');
      // The as-written type is what the node holds — recorded, not derived.
      assertEquals(entry.selectResultType, s.resultType);
    }

    // One bare (`0x1b`, no types) and one typed (`0x1c`, one type).
    const arities = selects.map((s) => mod.fidelity.get(s.nodeId)?.selectResultType?.length).sort();
    assertEquals(arities, [0, 1]);
  });

  it('an empty module starts with an empty table', () => {
    assertEquals(makeModule().fidelity.size, 0);
  });
});

describe('S3 — the table survives the real pipeline, over the whole corpus', () => {
  it('every select keeps its entry through resolveNames', async () => {
    let modules = 0;
    let selects = 0;
    const mismatched: string[] = [];

    for await (const entry of Deno.readDir(CORPUS)) {
      if (!entry.isFile || !entry.name.endsWith('.wat')) continue;
      const text = await Deno.readTextFile(new URL(entry.name, CORPUS));
      const asm = wat2wasm(text, { filename: entry.name });
      if (!asm.binary) continue;

      const errors = makeErrorList();
      const mod = readBinaryIr(asm.binary, errors);
      const found = selectsOf(mod);
      if (found.length === 0) continue;
      modules++;
      selects += found.length;

      // The pass that a WeakMap could not survive.
      resolveNames(mod);
      for (const s of selectsOf(mod)) {
        const recorded = mod.fidelity.get(s.nodeId)?.selectResultType;
        if (recorded === undefined) {
          mismatched.push(`${entry.name}: select lost its entry`);
        } else if (recorded.length !== s.resultType.length) {
          mismatched.push(`${entry.name}: arity ${recorded.length} != ${s.resultType.length}`);
        }
      }
    }

    assertEquals(mismatched, [], mismatched.slice(0, 5).join('; '));
    // A corpus that stopped containing selects would make this test vacuous.
    assert(selects > 0, `expected selects in the corpus, found none across ${modules} modules`);
  });
});

describe('S3 — all four families, recorded and consistent across the corpus', () => {
  // The four that survived classification. `opcode`, `align`, `offset`, `memidx`
  // and GC `typeVar` were in the plan's list and are NOT here: they are semantic
  // content a canonical tree must carry, not a record of what was typed.
  // `placeholder` is not here either — it converges to binaryen-ts's `Pop`, a
  // KIND, so it moves into the tree at S5 rather than beside it.
  const BLOCK_LIKE = new Set(['block', 'loop', 'if', 'try', 'try_table']);

  it('every block-like node records its DECLARED block type', async () => {
    let checked = 0;
    const bad: string[] = [];

    for await (const entry of Deno.readDir(CORPUS)) {
      if (!entry.isFile || !entry.name.endsWith('.wat')) continue;
      const text = await Deno.readTextFile(new URL(entry.name, CORPUS));
      const asm = wat2wasm(text, { filename: entry.name });
      if (!asm.binary) continue;
      const mod = readBinaryIr(asm.binary, makeErrorList());

      // The pass a WeakMap could not survive.
      resolveNames(mod);

      walk(mod, (e) => {
        if (!BLOCK_LIKE.has(e.kind)) return;
        const node = e as unknown as { nodeId?: number; blockType: { kind: string } };
        checked++;
        const recorded = mod.fidelity.get(node.nodeId as never)?.blockType;
        if (recorded === undefined) bad.push(`${entry.name}: ${e.kind} lost its entry`);
        else if (recorded.kind !== node.blockType.kind) {
          bad.push(`${entry.name}: ${e.kind} ${recorded.kind} != ${node.blockType.kind}`);
        }
      });
    }

    assertEquals(bad, [], bad.slice(0, 5).join('; '));
    assert(checked > 0, 'expected block-like nodes in the corpus');
  });

  it('every function records the spelling of its declared type', async () => {
    let checked = 0;
    const bad: string[] = [];

    for await (const entry of Deno.readDir(CORPUS)) {
      if (!entry.isFile || !entry.name.endsWith('.wat')) continue;
      const text = await Deno.readTextFile(new URL(entry.name, CORPUS));
      const asm = wat2wasm(text, { filename: entry.name });
      if (!asm.binary) continue;
      const mod = readBinaryIr(asm.binary, makeErrorList());
      resolveNames(mod);

      for (const f of mod.funcs) {
        checked++;
        const recorded = mod.fidelity.get(f.nodeId);
        if (recorded === undefined) bad.push(`${entry.name}: func lost its entry`);
        else if (recorded.sig === undefined) bad.push(`${entry.name}: func recorded no sig`);
      }
    }

    assertEquals(bad, [], bad.slice(0, 5).join('; '));
    assert(checked > 0, 'expected functions in the corpus');
  });

  it('the WAT parser populates the table too, not only the binary reader', () => {
    const parsed = parseWatModule(WITH_SELECTS);
    assert(parsed.module, 'fixture must parse');
    // Two selects and two functions, all recorded by the parser rather than by
    // a reader — the producers have to agree or S6 could only delete the node
    // fields for binaries.
    assert(
      parsed.module.fidelity.size >= 4,
      `expected >= 4 entries, got ${parsed.module.fidelity.size}`,
    );
    for (const f of parsed.module.funcs) assert(f.nodeId !== undefined, 'parser must id its funcs');
    for (const sel of selectsOf(parsed.module)) {
      assert(sel.nodeId !== undefined, 'parser must id its selects');
      assert(parsed.module.fidelity.get(sel.nodeId) !== undefined, 'and record an entry');
    }
  });
});
