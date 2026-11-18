// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// ONE nesting limit on every runtime (owner, 2026-11-13: option 1 of the depth report). How
// deep a module could nest depended on the host's JavaScript stack — measured that day, cold:
// 425 levels at the lowest on Node 22.18 / 24 / 26 and Deno, 5,794 on Bun 1.4.4, and on Node one
// module at one depth refused cold and accepted warm. Now every stage takes exactly
// MAX_NESTING_DEPTH (256) levels and refuses 257 in the same words, and a nest far past any
// runtime's stack is that same refusal — never the host's stack overflowing. `bun run test`
// runs this on V8 (Node 24, the floor of the V8 runtimes measured) and `bun run test:bun` on
// JavaScriptCore.
//
// Depth counts EVERY expression level, operands too: N nested blocks are N deep;
// `(drop (i32.add … (i32.const 0) …))` with N adds is N + 2.

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm, writeWat } from '../../../src/ir/write-wasm.ts';
import { Interpreter, Stop } from '../../../src/interp/interpreter.ts';
import { formatErrors } from '../../../src/core/error.ts';
import {
  DATA_CYCLE,
  DATA_TOO_DEEP,
  EXPRESSION_CYCLE,
  MAX_DATA_DEPTH,
  MAX_NESTING_DEPTH,
  MAX_SHARED_SLACK,
  moduleLimitProblem,
  NESTING_OVER_LIMIT,
  nestingDepth,
  NestingLimitError,
  SPARSE_ARRAY,
  WIDE_NUMBER,
} from '../../../src/ir/nesting.ts';
import { defaultPassOptions, PassRunner } from '../../../src/passes/pass.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import {
  BinaryOp,
  type Expression,
  makeBinary,
  makeBlock,
  makeCall,
  makeConst,
  makeDrop,
  makeIf,
  makeNop,
  makeTry,
} from '../../../src/ir/expressions.ts';
import { bundle } from '../../../src/tools/wasm-bundle.ts';
import { None, ValType } from '../../../src/ir/types.ts';
import { unshareInPlace } from '../../../src/ir/unshare.ts';

const N = MAX_NESTING_DEPTH;
const leb = (v: number): number[] => {
  const o: number[] = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    o.push(b);
  } while (v);
  return o;
};
const sec = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
function wrap(code: number[]): Uint8Array {
  const head = [
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...sec(1, [1, 0x60, 0, 0]),
    ...sec(3, [1, 0]),
    ...sec(7, [1, 1, 0x66, 0, 0]),
  ];
  const body = [...leb(code.length), ...code];
  return new Uint8Array([...head, 10, ...leb(body.length + 1), 1, ...body]);
}
/** A function `depth` deep: nested blocks. */
const blocks = (depth: number) => {
  const c = [0];
  for (let i = 0; i < depth; i++) c.push(2, 0x40);
  for (let i = 0; i <= depth; i++) c.push(0x0b);
  return wrap(c);
};
/** A function `depth` deep with no block at all: `drop` of `depth - 2` adds over a constant. */
const chain = (depth: number) => {
  const c = [0, 0x41, 0];
  for (let i = 0; i < depth - 2; i++) c.push(0x41, 1, 0x6a);
  c.push(0x1a, 0x0b);
  return wrap(c);
};
const foldedBlocks = (depth: number) =>
  `(module (func (export "f") ${'(block '.repeat(depth)}${')'.repeat(depth)}))`;
const foldedChain = (depth: number) =>
  `(module (func (export "f") (drop ${'(i32.add '.repeat(depth - 2)}(i32.const 0)${
    ' (i32.const 1))'.repeat(depth - 2)
  })))`;

/** What each stage says about bytes: 'ok', the limit's refusal, or anything else (a failure). */
type Verdict = 'ok' | 'limit' | string;
const said = (text: string): Verdict => text.includes(NESTING_OVER_LIMIT) ? 'limit' : text;
async function stages(bytes: Uint8Array): Promise<Record<string, Verdict>> {
  const v: Record<string, Verdict> = {};
  const errs = (r: { errors: Parameters<typeof formatErrors>[0] }) =>
    r.errors.length === 0 ? 'ok' : said(formatErrors(r.errors));
  const thrown = async (f: () => unknown) => {
    try {
      await f();
      return 'ok';
    } catch (e) {
      return said(String((e as Error).message));
    }
  };
  v['validate'] = errs(wasmValidate(bytes));
  v['wasm2wat'] = errs(wasm2wat(bytes, { fold: true }));
  v['read+write'] = await thrown(() => writeWasm(readForPasses(bytes)));
  v['wasm-opt -O2'] = await thrown(() => wasmOpt(bytes, { optimizeLevel: 2 }));
  v['interp'] = await thrown(() => new Interpreter(readForPasses(bytes)).invoke('f', []));
  return v;
}
const every = (v: Record<string, Verdict>, want: Verdict) =>
  Object.entries(v).filter(([, x]) => x !== want);

describe('one nesting limit — binary input, at every stage', () => {
  for (const [shape, make] of [['blocks', blocks], ['an operand chain', chain]] as const) {
    it(`${shape}: ${N} deep is taken by every stage`, async () => {
      assertEquals(every(await stages(make(N)), 'ok'), []);
    });
    it(`${shape}: ${N + 1} deep is refused by every stage, in the limit's words`, async () => {
      assertEquals(every(await stages(make(N + 1)), 'limit'), []);
    });
    it(`${shape}: 100,000 deep — past any runtime's stack — is the same refusal`, async () => {
      assertEquals(every(await stages(make(100_000)), 'limit'), []);
    });
  }
});

describe('one nesting limit — WAT input', () => {
  for (
    const [shape, make] of [['folded blocks', foldedBlocks], [
      'a folded chain',
      foldedChain,
    ]] as const
  ) {
    it(`${shape}: ${N} deep compiles, ${N + 1} and 100,000 are refused in the limit's words`, () => {
      assertEquals(wat2wasm(make(N)).errors.length, 0, formatErrors(wat2wasm(make(N)).errors));
      for (const d of [N + 1, 100_000]) {
        const r = wat2wasm(make(d));
        assertEquals(said(formatErrors(r.errors)), 'limit', `${shape} at ${d}`);
      }
    });
  }

  it('linear (unfolded) blocks: the same limit', () => {
    const linear = (d: number) =>
      `(module (func (export "f") ${'block '.repeat(d)}${'end '.repeat(d)}))`;
    assertEquals(wat2wasm(linear(N)).errors.length, 0);
    assertEquals(said(formatErrors(wat2wasm(linear(N + 1)).errors)), 'limit');
    assertEquals(said(formatErrors(wat2wasm(linear(100_000)).errors)), 'limit');
  });
});

describe('one nesting limit — constant expressions (extended-const chains)', () => {
  /** A global whose initializer is `depth` deep: `depth - 1` adds over a constant. */
  const global = (depth: number) => {
    const init = [0x41, 0];
    for (let i = 0; i < depth - 1; i++) init.push(0x41, 1, 0x6a);
    init.push(0x0b);
    return new Uint8Array([
      ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
      ...sec(6, [1, 0x7f, 0, ...init]), // one immutable i32 global
    ]);
  };
  it(`${N} deep is read; ${N + 1} and 100,000 are refused in the limit's words`, () => {
    readForPasses(global(N));
    for (const d of [N + 1, 100_000]) {
      let msg = '';
      try {
        readForPasses(global(d));
      } catch (e) {
        msg = String((e as Error).message);
      }
      assertEquals(said(msg), 'limit', `at ${d}`);
    }
  });
});

describe('one nesting limit — a module the reader did not make', () => {
  it('the optimizer, the writer and the interpreter each refuse it before recursing', () => {
    // Read within the limit, then made deeper in the IR, as a builder or a pass could.
    const m = readWat(foldedBlocks(N));
    let e: Expression = m.functions[0]!.body.children[0]!;
    while (e.kind === 'block' && e.children.length > 0) e = e.children[0]!;
    (e as { children: Expression[] }).children = [
      readWat(foldedBlocks(2)).functions[0]!.body.children[0]!,
    ];
    assertEquals(nestingDepth(m.functions[0]!.body), N + 2);
    let opt: unknown;
    try {
      new PassRunner(m, defaultPassOptions).add('Vacuum').run();
    } catch (x) {
      opt = x;
    }
    assert(opt instanceof NestingLimitError, String(opt));
    let w = '';
    try {
      writeWasm(m);
    } catch (x) {
      w = String((x as Error).message);
    }
    assertEquals(said(w), 'limit');
    let i: unknown;
    try {
      new Interpreter(m);
    } catch (x) {
      i = x;
    }
    assert(i instanceof Stop && i.message.includes(NESTING_OVER_LIMIT), String(i));
  });
});

describe('the limit is a promise, written down', () => {
  it('README states the same number, and it stays under the lowest measured capacity', async () => {
    // 425: the lowest cold capacity of any stage on any V8 runtime, 2026-11-13. A new limit is
    // measured on every runtime first (the depth report's method), then moved here and in README.
    const LOWEST_MEASURED_CAPACITY = 425;
    assert(MAX_NESTING_DEPTH <= LOWEST_MEASURED_CAPACITY * 0.75, String(MAX_NESTING_DEPTH));
    const readme = await (await import('../../test_fs.ts')).readTextFile('README.md');
    assert(
      readme.includes(
        `| ${MAX_NESTING_DEPTH} levels (\`MAX_NESTING_DEPTH\`), the same on every runtime |`,
      ),
      'README limits table',
    );
    assert(NESTING_OVER_LIMIT.includes(`deeper than ${MAX_NESTING_DEPTH} levels`));
    assert(readme.includes(`"${NESTING_OVER_LIMIT}"`), 'README quotes the refusal');
  });
});

// Security review round 3, class 1 (2026-11-13): the API can build a DAG — one node as both
// operands of the next, k times — which every walk expands into 2^k nodes: the depth check took
// 719 ms at k = 24 and would never finish at k = 40, and one such subtree as the body of 400
// functions took 34 s to check and the writer to 6.9 GB. Two fixes were beaten — a per-function
// cap (by the 400 functions), and refusing ANY shared node (by Flatten and the custom-page-size
// lowering, which reuse a node, and binaryen.js's `i32.add(x, x)`). Now the measure: walking the
// module may cost at most twice its distinct nodes plus MAX_SHARED_SLACK, found without expanding
// anything; a cycle is always refused; imports' fields are covered; and the writer's copy is held
// to the same bound for every object it copies.
describe('one bound on shared subtrees — walking a module costs what it holds', () => {
  const leaf = () => makeConst({ type: ValType.I32, value: 1 });
  /** `k` levels, each an `i32.add` whose two operands are the SAME node. */
  const dag = (k: number): Expression => {
    let e: Expression = leaf();
    for (let i = 0; i < k; i++) e = makeBinary(BinaryOp.AddI32, e, e);
    return e;
  };
  /** The same shape with every node its own object: a tree. */
  const tree = (k: number): Expression =>
    k === 0 ? leaf() : makeBinary(BinaryOp.AddI32, tree(k - 1), tree(k - 1));
  /** `n` functions, each `(drop <body>)`. */
  const moduleOf = (body: () => Expression, n = 1) => {
    const m = readWat(`(module ${'(func (drop (i32.const 0))) '.repeat(n)}(export "f" (func 0)))`);
    for (const f of m.functions) (f.body.children[0]! as { value: Expression }).value = body();
    return m;
  };
  const msg = (f: () => unknown) => {
    try {
      f();
      return 'accepted';
    } catch (x) {
      return String((x as Error).message);
    }
  };
  /** What each stage that throws says about `m`. */
  const refusals = (m: ReturnType<typeof moduleOf>) => ({
    check: moduleLimitProblem(m) ?? 'accepted',
    write: msg(() => writeWasm(m)),
    passes: msg(() => new PassRunner(m, defaultPassOptions).add('Vacuum').run()),
    interp: msg(() => new Interpreter(m)),
  });
  const EXPANDS = 'subtrees shared by reference expand the module to ';
  const DATA_EXPANDS = 'objects shared by reference expand the module to ';

  it('k = 40 (2^40 nodes as walked) is refused at once, at every stage that throws', () => {
    const t = performance.now();
    const r = refusals(moduleOf(() => dag(40)));
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
    assert(r.check.startsWith(EXPANDS), r.check);
    assert(r.write.startsWith(EXPANDS), r.write);
    assert(r.passes.startsWith(`optimizer: ${EXPANDS}`), r.passes);
    assert(r.interp.startsWith(`unsupported: ${EXPANDS}`), r.interp);
  });

  it("ONE shared subtree as the body of 400 functions — the first retest's case — at once", () => {
    const shared = dag(21);
    const t = performance.now();
    assert(refusals(moduleOf(() => shared, 400)).check.startsWith(EXPANDS));
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
  });

  it("a little reuse — a pass's, binaryen.js's `add(x, x)` — is accepted, and written as a tree", () => {
    const shared = moduleOf(() => dag(6), 3); // one node used twice at each of 6 levels
    const plain = moduleOf(() => tree(6), 3);
    assertEquals(refusals(shared), {
      check: 'accepted',
      write: 'accepted',
      passes: 'accepted',
      interp: 'accepted',
    });
    assertEquals([...writeWasm(moduleOf(() => dag(6), 3))], [...writeWasm(plain)]);
  });

  it('the bound: walked ≤ 2 × distinct + MAX_SHARED_SLACK, exactly at its edge', () => {
    // One shared subtree of S distinct nodes used by F functions: walked ≈ F·S, distinct ≈ S + F·2.
    const shared = tree(12); // 8,191 distinct nodes
    const over = moduleOf(() => shared, 200); // walked ~1.64M + framing > 2·(8,191+…) + 1M
    const under = moduleOf(() => shared, 100); // walked ~0.82M < 1M slack
    assert(String(moduleLimitProblem(over)).startsWith(EXPANDS), String(moduleLimitProblem(over)));
    assertEquals(moduleLimitProblem(under), undefined);
    assert(MAX_SHARED_SLACK === 1_000_000);
  });

  it('a cycle is refused, not walked forever', () => {
    const a = makeBinary(BinaryOp.AddI32, leaf(), leaf()) as unknown as {
      left: unknown;
      right: unknown;
    };
    a.left = a;
    assertEquals(refusals(moduleOf(() => a as unknown as Expression)).check, EXPRESSION_CYCLE);
  });

  it("an import's fields are measured too (the second retest's case)", () => {
    const m = readWat('(module (import "e" "f" (func)) (func (export "g")))');
    const imp = m.imports[0]! as unknown as { func: { body: Expression } };
    imp.func.body = { kind: 'region', children: [makeDrop(dag(40))] } as unknown as Expression;
    const t = performance.now();
    assert(String(moduleLimitProblem(m)).startsWith(EXPANDS));
    assert(msg(() => writeWasm(m)).startsWith(EXPANDS));
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
  });

  it("the writer's copy is held to the same bound for objects that are not expressions", () => {
    // A location object shared k levels deep — the copy expanded it (the second retest's case).
    let loc: Record<string, unknown> = { filename: '', line: 0, column: 0, offset: 0 };
    for (let i = 0; i < 40; i++) loc = { a: loc, b: loc };
    const m = moduleOf(() => leaf());
    (m.functions[0]!.body.children[0]! as { loc: unknown }).loc = loc;
    const t = performance.now();
    assert(msg(() => writeWasm(m)).startsWith(DATA_EXPANDS));
    assert(performance.now() - t < 5_000, `${performance.now() - t} ms`);
  });

  // Class 1's THIRD retest (2026-11-15): the bundler rewrote a reused node once per path; the
  // writer's copy bound counted objects against a slack in nodes; the packed size lost its
  // height past 2^44; the early stop counted regions as levels.
  it('the bundler gives each use of a reused node its own copy: the same bundle as a tree', () => {
    const src = (n: string) =>
      `(module (memory 1) (data (i32.const 0) "abcdefgh") (func (export "${n}") (result i32) ` +
      '(i32.add (i32.load (i32.const 4)) (i32.load (i32.const 4)))))';
    const bundled = (share: boolean) => {
      const b = readWat(src('fb'));
      if (share) {
        const add = b.functions[0]!.body.children[0]! as { left: unknown; right: unknown };
        add.right = add.left; // binaryen.js's add(x, x)
      }
      const { module } = bundle([{ name: 'a', module: readWat(src('fa')) }, {
        name: 'b',
        module: b,
      }], {
        unmarked: 'guess',
        log: undefined,
      });
      return [...writeWasm(module)];
    };
    assertEquals(bundled(true), bundled(false));
  });

  it('what the expression check accepts, the writer writes (the copy bound counts objects)', () => {
    const shared = tree(12); // 8,191 distinct nodes, under 100 functions: walked ~0.82M
    const m = moduleOf(() => shared, 100);
    assertEquals(moduleLimitProblem(m), undefined);
    assertEquals(msg(() => writeWasm(m)), 'accepted');
  });

  // Class 1's FOURTH retest (2026-11-15): the copy counted an array as one object, however long,
  // so one shared array of a million types under 100 blocks copied 1e8 entries (4.2 s, 3.5 GB).
  // The FIFTH (2026-11-15): only the writer's copy counted it, so the same module cost an
  // optimizer run 3.8 s and 8.8 GB at 160 blocks; and an array of one entry at index 4e8 (its
  // `length` all the copy counted) ran the copy out of memory. The check measures all data now.
  const blocks = (type: unknown, n: number) => {
    const m = moduleOf(() => leaf());
    (m.functions[0]!.body as { children: Expression[] }).children = Array.from(
      { length: n },
      () => makeBlock([makeNop()], null, type as never),
    );
    return m;
  };
  it('data shared by reference — not only expressions — is bounded at every stage', () => {
    const big = blocks(new Array(1_000_000).fill(ValType.I32), 100);
    const t = performance.now();
    const r = refusals(big);
    for (const said of Object.values(r)) assert(said.includes(DATA_EXPANDS), JSON.stringify(r));
    assert(performance.now() - t < 4_000, `${performance.now() - t} ms`);
    // a short shared type list — what a builder might reuse — is copied and written
    assertEquals(msg(() => writeWasm(blocks([ValType.I32, ValType.I32], 1_000))), 'accepted');
  });

  it('a sparse array is refused at its first hole, before anything fills it', () => {
    const holey: unknown[] = [];
    holey[400_000_000] = ValType.I32;
    const t = performance.now();
    const r = refusals(blocks(holey, 1));
    for (const said of Object.values(r)) assert(said.includes(SPARSE_ARRAY), JSON.stringify(r));
    assert(performance.now() - t < 1_000, `${performance.now() - t} ms`);
  });

  // The SIXTH (2026-11-15): bytes, strings and a fidelity table's rec groups were written or
  // cloned per use, uncounted; a Uint16Array was walked an element at a time.
  const shareInto = (n: number, src: string, put: (m: ReturnType<typeof moduleOf>) => void) => {
    const m = readWat(`(module ${src.repeat(n)})`);
    put(m);
    return m;
  };
  it('one byte array as the data of 64 segments is refused, not written 64 times', () => {
    const bytes = new Uint8Array(8 << 20);
    const m = shareInto(64, '(data "") ', (m) => {
      for (const d of m.dataSegments) (d as { data: unknown }).data = bytes;
    });
    const r = refusals(m);
    for (const said of Object.values(r)) assert(said.includes(DATA_EXPANDS), JSON.stringify(r));
  });
  it('one long string as the name of 100 exports is refused; a short one repeated is not', () => {
    const named = (s: string) =>
      shareInto(100, '(func (export "e")) ', (m) => {
        for (const e of m.exports) e.name = s;
      });
    const long = 'x'.repeat(4 << 20);
    const r = refusals(named(long));
    for (const said of Object.values(r)) assert(said.includes(DATA_EXPANDS), JSON.stringify(r));
    assertEquals(moduleLimitProblem(named('y'.repeat(200))), undefined);
  });
  it("a fidelity table's empty rec groups are counted where the table is used", () => {
    const m = moduleOf(() => leaf());
    for (let i = 0; i < 2_000_000; i++) m.fidelity.addEmptyRecGroup(0);
    for (const f of [...Array(100)].map(() => ({ ...m.functions[0]! }))) {
      (f as unknown as { extra: unknown }).extra = m.fidelity;
      m.functions.push(f);
    }
    assert(String(moduleLimitProblem(m)).startsWith(DATA_EXPANDS));
  });
  it('a typed array is one leaf of its bytes, measured at once', () => {
    const m = shareInto(1, '(memory 1) (data (i32.const 0) "") ', (m) => {
      (m.dataSegments[0] as { data: unknown }).data = new Uint16Array(5_000_000);
    });
    const t = performance.now();
    assertEquals(moduleLimitProblem(m), undefined);
    assert(performance.now() - t < 500, `${performance.now() - t} ms`);
  });

  // The SEVENTH (2026-11-15): a node or a byte array shared BETWEEN two inputs was relocated by
  // both; a huge bigint held once was written per use.
  const twoInputs = (
    share: (a: ReturnType<typeof readWat>, b: ReturnType<typeof readWat>) => void,
  ) => {
    const z = '\\00';
    const src = (tag: string) =>
      `(module (memory (export "memory") 1) (data (i32.const 1024) "${tag}bc${z}")` +
      ` (data (i32.const 1040) (@reloc data) "${z}\\04${z}${z}")` +
      ` (func (export "w${tag}") (result i32) (i32.load (i32.add (@reloc data) (i32.const 4) (i32.const 0)))))`;
    const a = readWat(src('a'));
    const b = readWat(src('b'));
    share(a, b);
    const { module } = bundle([{ name: 'a', module: a }, { name: 'b', module: b }], {
      onConflict: 'prefix',
      log: undefined,
    });
    return [...writeWasm(module)];
  };
  it('a node shared between two bundle inputs is relocated once for each', () => {
    const tree = twoInputs(() => {});
    const shared = twoInputs((a, b) => {
      const at = (m: typeof a) => m.functions[0]!.body as { children: Expression[] };
      at(b).children[0] = at(a).children[0]!;
    });
    assertEquals(shared, tree);
  });
  it('a byte array shared between two bundle inputs is relocated once for each', () => {
    const tree = twoInputs(() => {});
    const shared = twoInputs((a, b) => {
      (b.dataSegments[1] as { data: Uint8Array }).data = a.dataSegments[1]!.data;
    });
    assertEquals(shared, tree);
  });
  it('a bigint wider than 64 bits is refused at every stage', () => {
    const m = moduleOf(() => leaf());
    const c = m.functions[0]!.body.children[0]! as { value: { value: { value: unknown } } };
    c.value = makeConst({ type: ValType.I64, value: (1n << 1_000_000n) - 1n }) as never;
    const r = refusals(m);
    for (const said of Object.values(r)) assert(said.includes(WIDE_NUMBER), JSON.stringify(r));
    // the widest a value holds, both ways, is accepted
    c.value = makeConst({ type: ValType.I64, value: (1n << 64n) - 1n }) as never;
    assertEquals(moduleLimitProblem(m), undefined);
  });

  // The EIGHTH (2026-11-15): the optimizer rewrote a reused node once per path — SimplifyLocals
  // sank a call into a `local.get` used twice, so the call ran twice; and the bundler bounded
  // each input but not one module given as many.
  // The NINTH (2026-11-15): a Var shared by a type use and a local.get, and a locals list shared
  // by many functions, were rewritten once per use; a whole-module copy left handles stale.
  it('a Var shared by a type use and a local.get is renumbered once, for each', () => {
    const src = '(module (type $unused (func (param f64)))' +
      ' (func (export "f") (param i32 i32) (result i32) (local.get 1)))';
    const optimized = (share: boolean) => {
      const m = readWat(src);
      const f = m.functions[0]!;
      if (share) (f.body.children[0]! as { var: unknown }).var = f.typeVar;
      new PassRunner(m, defaultPassOptions).add('RemoveUnusedTypes').run();
      return new Interpreter(readForPasses(writeWasm(m))).invoke('f', [
        { type: ValType.I32, value: 10 },
        { type: ValType.I32, value: 20 },
      ]);
    };
    assertEquals(optimized(true), optimized(false));
  });
  it("one locals list under many functions: each function's own after the optimizer", () => {
    const fn = (i: number) =>
      `(func (export "f${i}") (param i32) (result i32) (i32.add (i32.mul (local.get 0) (i32.const ${i}))` +
      ' (i32.mul (local.get 0) (i32.const 3))))';
    const optimized = (share: boolean) => {
      const m = readWat(`(module ${[0, 1, 2, 3, 4, 5, 6, 7].map(fn).join(' ')})`);
      if (share) { for (const f of m.functions) f.locals = m.functions[0]!.locals; }
      new PassRunner(m, defaultPassOptions).add('Flatten').run();
      return [...writeWasm(m)];
    };
    assertEquals(optimized(true), optimized(false));
  });
  it('the optimizer keeps what the caller holds: a function reached once is still the live one', () => {
    const m = readWat(
      '(module (func (export "f") (result i32) (i32.add (i32.const 1) (i32.const 2))))',
    );
    const f = m.functions[0]!;
    const add = f.body.children[0]! as { left: unknown; right: unknown };
    add.right = add.left; // a reused node: unshared in place, around the caller's handles
    new PassRunner(m, defaultPassOptions).add('Vacuum').run();
    assert(m.functions[0] === f, 'the function object the caller holds is the module’s still');
  });

  // The TENTH (2026-11-15): objects kept shared as "values" by their shape — a reference type
  // held a Var a pass renumbers; a node given a location's keys — and data deep enough to run the
  // unshare's copy out of stack.
  it("a Var inside a parameter's reference type, shared with a local.get, is renumbered once for each", () => {
    const src = '(module (type $unused (func (param f64))) (type $t (struct))' +
      ' (func (export "f") (param i32 i32 (ref null $t)) (result i32) (local.get 1)))';
    const optimized = (share: boolean) => {
      const m = readWat(src);
      const f = m.functions[0]!;
      if (share) {
        const ref = f.sig.params[2] as unknown as { heapType: unknown };
        (f.body.children[0]! as { var: unknown }).var = ref.heapType;
      }
      new PassRunner(m, defaultPassOptions).add('RemoveUnusedTypes').run();
      return [...writeWasm(m)];
    };
    assertEquals(optimized(true), optimized(false));
  });
  it("a reused node carrying a location's keys is still given one per use", () => {
    const src = '(module (global $c (mut i32) (i32.const 0))' +
      ' (func $side (result i32) (global.set $c (i32.add (global.get $c) (i32.const 1))) (global.get $c))' +
      ' (func (export "f") (result i32) (local i32) (local.set 0 (call $side))' +
      ' (i32.add (local.get 0) (local.get 0))))';
    const optimized = (share: boolean) => {
      const m = readWat(src);
      const add = m.functions[1]!.body.children[1]! as unknown as {
        left: Record<string, unknown>;
        right: unknown;
      };
      if (share) {
        Object.assign(add.left, { filename: '', line: 0, column: 0 });
        add.right = add.left;
      }
      new PassRunner(m, defaultPassOptions).add('SimplifyLocals').run();
      return new Interpreter(readForPasses(writeWasm(m))).invoke('f', []);
    };
    assertEquals(optimized(true), optimized(false));
  });
  it(`data nested past ${MAX_DATA_DEPTH} objects is refused at every stage, not a stack overflow`, () => {
    const m = moduleOf(() => leaf());
    let chain: Record<string, unknown> = {};
    for (let i = 0; i < 100_000; i++) chain = { next: chain };
    const node = m.functions[0]!.body.children[0]! as { meta?: unknown };
    node.meta = chain;
    const r = refusals(m);
    for (const said of Object.values(r)) assert(said.includes(DATA_TOO_DEEP), JSON.stringify(r));
    // ifs nested to the expression limit — three objects a level — are within it, and written
    let e: Expression = makeNop();
    for (let i = 2; i < MAX_NESTING_DEPTH; i++) e = makeIf(leaf(), [e]); // + the drop + the nop
    const deepest = moduleOf(() => e);
    assertEquals(moduleLimitProblem(deepest), undefined);
    assertEquals(msg(() => writeWasm(deepest)), 'accepted');
  });

  // The ELEVENTH (2026-11-15): depth checked on the first path only, so chains of chains each
  // found shallow nested 40,000 deep; and one loop node at two sites was held to the first
  // site's hang sample.
  it('data reached again by a deeper path is held to the depth limit there too', () => {
    const m = moduleOf(() => leaf()) as unknown as Record<string, unknown>;
    let prev: Record<string, unknown> = { leaf: 1 };
    for (let k = 1; k <= 40; k++) {
      let tail = prev;
      for (let j = 0; j < 999; j++) tail = { next: tail };
      prev = { next: tail };
      m[`y${k}`] = prev; // each head found first at the top, shallow
    }
    const r = refusals(m as never);
    for (const said of Object.values(r)) assert(said.includes(DATA_TOO_DEEP), JSON.stringify(r));
  });
  it('a loop node at two sites is not held to the other run’s hang sample', () => {
    const loop = '(loop $L (local.set $c (i32.add (local.get $c) (i32.const 1)))' +
      ' (br_if $L (i32.eq (local.get $c) (i32.const 1))))';
    const m = readWat(
      `(module (func (export "f") (result i32) (local $c i32) (local.set $c (i32.const 0)) ${loop}` +
        ` (local.set $c (i32.const 0)) ${loop} (local.get $c)))`,
    );
    const body = m.functions[0]!.body as { children: Expression[] };
    body.children[3] = body.children[1]!; // the second loop IS the first
    assertEquals(new Interpreter(m, { hangCheck: 0 }).invoke('f', []), [{
      type: ValType.I32,
      value: 2,
    }]);
  });

  // The TWELFTH (2026-11-15): the bundler found relocation sites by source offset, one node per
  // offset, so of a reused relocated constant's uses (each copied, each keeping the location)
  // only the last was moved.
  it("a reused relocated constant is moved at every use: a linked object's address stays right", () => {
    const fixtures = 'tests/binaryen-ts/tools/fixtures/bundle/';
    const load = (n: string) => readForPasses(new Uint8Array(readFileSync(fixtures + n)), n);
    const labelPtr = (variant: 'plain' | 'reuse' | 'clone') => {
      const m = load('mathlib_zig.wasm');
      const exp = m.exports.find((e) => e.name === 'label_ptr')!;
      const v = exp.var as { kind: string; name?: string; value?: number };
      const f = v.kind === 'name'
        ? m.functions.find((fn) => fn.name === v.name)!
        : m.functions[v.value! - m.imports.length]!;
      if (variant !== 'plain') {
        const find = (e: unknown): Record<string, unknown> | undefined => {
          if (e === null || typeof e !== 'object' || ArrayBuffer.isView(e)) return undefined;
          const o = e as Record<string, unknown>;
          if (o['kind'] === 'const' && o['loc'] !== undefined) return o;
          for (const v of Object.values(o)) {
            const r = find(v);
            if (r !== undefined) return r;
          }
          return undefined;
        };
        const c = find(f.body)!;
        const again = variant === 'reuse' ? c : structuredClone(c); // the clone keeps the location
        const swap = (e: Record<string, unknown>): boolean => {
          for (const [k, v] of Object.entries(e)) {
            if (v === c) {
              // c + c + c: right only when EVERY use is moved (one moved, either end, is not)
              e[k] = makeBinary(
                BinaryOp.AddI32,
                makeBinary(BinaryOp.AddI32, c as never, again as never),
                c as never,
              );
              return true;
            }
            if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v) && swap(v as never)) {
              return true;
            }
          }
          return false;
        };
        assert(swap(f.body as never));
      }
      const { module } = bundle([
        { name: 'strlib', module: load('strlib_rust.wasm') },
        { name: 'mathlib', module: m },
      ], { log: undefined });
      const instance = new WebAssembly.Instance(
        new WebAssembly.Module(writeWasm(module) as Uint8Array<ArrayBuffer>),
        {},
      );
      return (instance.exports['label_ptr'] as () => number)();
    };
    const want = (3 * labelPtr('plain')) | 0;
    assertEquals(labelPtr('reuse'), want);
    assertEquals(labelPtr('clone'), want);
  });

  // The THIRTEENTH (2026-11-15): a data segment listed twice had only its first copy's words
  // moved; two nodes sharing a NodeId shared what resolving recorded.
  it('a data segment listed twice in a linked input has its words moved in both', () => {
    const fixtures = 'tests/binaryen-ts/tools/fixtures/bundle/';
    const load = (n: string) => readForPasses(new Uint8Array(readFileSync(fixtures + n)), n);
    const names = (twice: boolean) => {
      const m = load('strbin_rust.wasm');
      if (twice) {
        // listed again under a name of its own (one name twice is refused: the fifteenth retest)
        for (const s of m.dataSegments.filter((d) => d.kind === 'active')) {
          m.dataSegments.push({ ...s, name: `${s.name}.again` });
        }
      }
      const { module } = bundle([{ name: 'a', module: load('mathlib_zig.wasm') }, {
        name: 'b',
        module: m,
      }], {
        onConflict: 'prefix',
        log: undefined,
      });
      const wasi = new Proxy({}, { get: () => () => 0 });
      const bytes = writeWasm(module) as Uint8Array<ArrayBuffer>;
      const ex = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
        wasi_snapshot_preview1: wasi,
      }).exports as Record<string, unknown>;
      const mem = ex['memory'] as WebAssembly.Memory;
      const ptr = ex['name_ptr'] as (i: number) => number;
      const len = ex['name_len'] as (i: number) => number;
      return [0, 1].map((i) =>
        new TextDecoder().decode(new Uint8Array(mem.buffer, ptr(i), len(i)))
      );
    };
    assertEquals(names(true), names(false));
  });
  it('a node spread and edited keeps its own written form: the original is untouched', () => {
    const src = '(module' +
      ' (func (export "a") (result i32) (select (result i32) (i32.const 1) (i32.const 2) (i32.const 0)))' +
      ' (func (export "b") (result i32) (select (result i32) (i32.const 3) (i32.const 4) (i32.const 1))))';
    const m = readWat(src);
    const a = m.functions[0]!.body.children[0]! as unknown as Record<string, unknown>;
    const f32 = () => makeConst({ type: ValType.F32, bits: 0 });
    // function b becomes an f32 select spread from a's: one NodeId, two nodes
    (m.functions[1]!.body as { children: unknown[] }).children[0] = {
      ...a,
      val1: f32(),
      val2: f32(),
      resultType: [ValType.F32],
      type: ValType.F32,
    };
    (m.functions[1] as { sig: unknown }).sig = { params: [], results: [ValType.F32] };
    assert(WebAssembly.validate(writeWasm(m) as Uint8Array<ArrayBuffer>));
  });

  // The FOURTEENTH (2026-11-15): a copy spread from a relocated node and edited was moved too;
  // a global exported twice was an address global only if that name came last; and one function
  // listed twice printed text that does not read.
  it('a copy spread from a relocated constant and edited is not moved as an address', () => {
    const z = '\\00';
    const src = (tag: string) =>
      `(module (memory (export "memory") 1) (data (i32.const 1024) "${tag}bc${z}")` +
      ` (data (i32.const 1040) (@reloc data) "${z}\\04${z}${z}")` +
      ` (func (export "w${tag}") (result i32) (i32.add (@reloc data) (i32.const 4) (i32.const 0))))`;
    const consts = (variant: 'fresh' | 'spread', first: boolean) => {
      const b = readWat(src('b'));
      const add = b.functions[0]!.body.children[0]! as unknown as Record<string, unknown>;
      const c = add['left'] as Record<string, unknown>;
      const edited = variant === 'spread'
        ? { ...c, value: { type: ValType.I32, value: 77 } } // keeps the location
        : makeConst({ type: ValType.I32, value: 77 });
      // the edited copy before the original, or after it (the fifteenth retest: before)
      if (first) [add['left'], add['right']] = [edited, c];
      else add['right'] = edited;
      return msg(() => {
        const { module } = bundle([{ name: 'a', module: readWat(src('a')) }, {
          name: 'b',
          module: b,
        }], {
          onConflict: 'prefix',
          log: undefined,
        });
        const ex = new WebAssembly.Instance(
          new WebAssembly.Module(writeWasm(module) as Uint8Array<ArrayBuffer>),
          {},
        ).exports as Record<string, () => number>;
        throw new Error(`wb = ${ex['wb']!()}`);
      });
    };
    // a fresh 77 is not moved, and the original is, in either order
    assertEquals(consts('fresh', false), consts('fresh', true));
    assert(consts('fresh', false).startsWith('wb = '));
    // a copy carrying the location but holding another value: refused, never guessed
    for (const first of [false, true]) {
      const said = consts('spread', first);
      assert(said.includes('that differ') && said.includes('cannot be told'), said);
    }
  });
  it('a global exported as an address global and as an alias moves, in either order', () => {
    const moved = (order: string[]) => {
      const a = readWat(
        '(module (memory 1) (data (i32.const 1024) "abc") (global $g i32 (i32.const 1024))' +
          order.map((n) => ` (export "${n}" (global $g))`).join('') +
          ' (func (export "f") (result i32) (global.get $g)))',
      );
      const pad = readWat('(module (memory 2) (func (export "pad")))');
      const { module } = bundle([{ name: 'p', module: pad }, { name: 'a', module: a }], {
        onConflict: 'prefix',
        unmarked: 'guess',
        log: undefined,
      });
      return JSON.stringify(
        module.globals.map((g) => g.init),
        (k, v) => (k === 'loc' || k === 'nodeId' ? undefined : v),
      );
    };
    const one = moved(['__memory_base']);
    assert(one.includes('132096'), one); // 1024 + the 2 pages before it
    assertEquals(moved(['__memory_base', 'alias']), one);
    assertEquals(moved(['alias', '__memory_base']), one);
  });
  it('one function listed twice is refused by both writers and the bundler: `$f` could mean either', () => {
    const m = readWat('(module (func $f (result i32) (i32.const 1)))');
    m.functions.push(m.functions[0]!);
    const said = 'cannot write the module: two functions are both named $f';
    assertEquals(msg(() => writeWasm(m)), said);
    assertEquals(msg(() => writeWat(m)), said);
    assertEquals(
      msg(() => bundle([{ name: 'm', module: m }])),
      'm: two functions are both named $f',
    );
  });
  // The SIXTEENTH (2026-11-15): an import and a definition, or two imports, with one name.
  it('an import and a definition with one name are refused by both writers and the bundler', () => {
    const src =
      '(module (import "e" "g" (func $g (result i32))) (import "e" "b" (func $b (result i32)))' +
      ' (global $x (import "e" "x") i32) (global $y i32 (i32.const 9))' +
      ' (func $h (result i32) (i32.const 2)) (func (export "x") (result i32) (call $h)))';
    const cases: [(m: ReturnType<typeof readWat>) => void, string][] = [
      [(m) => (m.functions[0]!.name = '$g'), 'two functions are both named $g'],
      [
        (m) => ((m.imports[0] as { func: { name: string } }).func.name = '$b'),
        'two functions are both named $b',
      ],
      [(m) => (m.globals[0]!.name = '$x'), 'two globals are both named $x'],
    ];
    for (const [edit, said] of cases) {
      const m = readWat(src);
      edit(m);
      assertEquals(msg(() => writeWasm(m)), `cannot write the module: ${said}`);
      assertEquals(msg(() => writeWat(m)), `cannot write the module: ${said}`);
      assertEquals(
        msg(() => bundle([{ name: 'm', module: m }], { unmarked: 'guess' })),
        `m: ${said}`,
      );
    }
  });

  // The REVIEW OF CLASS 1's FIXES (2026-11-15): two false refusals and two untested rules.
  it('a try in a catch, nested to the expression limit, is within the data depth', () => {
    const region = (c: Expression[]) => makeTry(null, c, [], null, None).body;
    let e: Expression = makeNop();
    for (let i = 2; i < MAX_NESTING_DEPTH; i++) {
      e = makeTry(null, [makeNop()], [{ isRef: false, body: region([e]) }], null, None);
    }
    const m = moduleOf(() => e); // + the drop + the nop: 256 levels, five objects a level
    assertEquals(moduleLimitProblem(m), undefined);
    assertEquals(msg(() => writeWasm(m)), 'accepted');
  });
  it('one long name used by many references, nothing reused, is not refused', () => {
    const name = `$${'n'.repeat(1_000)}`;
    const m = readWat(`(module (func ${name}) (func))`);
    (m.functions[1]!.body as { children: Expression[] }).children = Array.from(
      { length: 20_000 },
      () => makeCall({ kind: 'name', name } as never, [], None),
    );
    assertEquals(moduleLimitProblem(m), undefined);
  });
  it('a data segment spread and edited, keeping its location, is refused rather than guessed', () => {
    const fixtures = 'tests/binaryen-ts/tools/fixtures/bundle/';
    const load = (n: string) => readForPasses(new Uint8Array(readFileSync(fixtures + n)), n);
    const m = load('strbin_rust.wasm');
    for (const s of m.dataSegments.filter((d) => d.kind === 'active')) {
      m.dataSegments.push({ ...s, name: `${s.name}.edited`, data: s.data.map((b) => b ^ 0xff) });
    }
    const said = msg(() =>
      bundle([{ name: 'a', module: load('mathlib_zig.wasm') }, { name: 'b', module: m }])
    );
    assert(said.includes('data segments that differ'), said);
  });
  it('the optimizer’s unshare keeps the fidelity table shared: the module’s one', () => {
    const m = readWat('(module (func (nop)))');
    (m.functions[0] as unknown as { extra: unknown }).extra = m.fidelity; // reached twice
    unshareInPlace(m);
    assert((m.functions[0] as unknown as { extra: unknown }).extra === m.fidelity);
  });

  it("the optimizer gives a reused node one per use first: binaryen.js's add(x, x) keeps its value", () => {
    const src = '(module (global $c (mut i32) (i32.const 0))' +
      ' (func $side (result i32) (global.set $c (i32.add (global.get $c) (i32.const 1))) (global.get $c))' +
      ' (func (export "f") (result i32) (local i32) (local.set 0 (call $side))' +
      ' (i32.add (local.get 0) (local.get 0))))';
    const optimized = (share: boolean, level: 0 | 3) => {
      const m = readWat(src);
      if (share) {
        const add = m.functions[1]!.body.children[1]! as { left: unknown; right: unknown };
        add.right = add.left;
      }
      const runner = new PassRunner(m, { ...defaultPassOptions, optimizeLevel: level });
      if (level === 0) runner.add('SimplifyLocals');
      else runner.addDefaultOptimizationPasses();
      runner.run();
      return [...writeWasm(m)];
    };
    for (const level of [0, 3] as const) {
      assertEquals(optimized(true, level), optimized(false, level));
    }
  });
  it('one module given to the bundler as many inputs is bounded by what it holds', () => {
    const shared = tree(12);
    const one = moduleOf(() => shared, 100); // walked ~0.82M from 8,191 distinct: accepted alone
    const inputs = [1, 2, 3, 4].map((i) => ({ name: `m${i}`, module: one }));
    const t = performance.now();
    const said = msg(() => bundle(inputs, { onConflict: 'prefix', log: undefined }));
    assert(said.startsWith(`the inputs: ${EXPANDS}`), said);
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
  });

  it('a cycle through data that is not an expression is refused', () => {
    const m = moduleOf(() => leaf());
    const loc: Record<string, unknown> = { filename: '', line: 0, column: 0, offset: 0 };
    loc['self'] = loc;
    (m.functions[0]!.body.children[0]! as { loc: unknown }).loc = loc;
    const r = refusals(m);
    for (const said of Object.values(r)) assert(said.includes(DATA_CYCLE), JSON.stringify(r));
  });

  it("a 2^55 expansion is refused in the sharing bound's words, not the depth limit's", () => {
    const r = String(moduleLimitProblem(moduleOf(() => dag(55))));
    assert(r.startsWith(EXPANDS), r);
  });

  it('the early stop counts levels as the height does: 200 nested ifs (a region per arm) pass', () => {
    let e: Expression = makeNop();
    for (let i = 0; i < 200; i++) e = makeIf(leaf(), [e]);
    const m = moduleOf(() => e);
    // drop(if …) — 200 ifs, each a level, regions not — so within 256.
    (m.functions[0]!.body as { children: Expression[] }).children = [e];
    assertEquals(moduleLimitProblem(m), undefined);
    let deeper: Expression = makeNop();
    for (let i = 0; i < 300; i++) deeper = makeIf(leaf(), [deeper]);
    (m.functions[0]!.body as { children: Expression[] }).children = [deeper];
    assertEquals(moduleLimitProblem(m), NESTING_OVER_LIMIT);
  });

  it('a tree of a million nodes, no sharing, passes', () => {
    const wide = readWat(`(module (func ${'(nop) '.repeat(1_000_000)}))`);
    assertEquals(moduleLimitProblem(wide), undefined);
  });
});

describe('nestingDepth — measured without recursing', () => {
  it('counts every level, operands included, and a region is not one', () => {
    assertEquals(nestingDepth(readForPasses(blocks(5)).functions[0]!.body), 5);
    assertEquals(nestingDepth(readForPasses(chain(9)).functions[0]!.body), 9);
    assertEquals(nestingDepth(readForPasses(blocks(1)).functions[0]!.body), 1);
  });

  it('measures a million levels without the stack', () => {
    // A tree built directly, a million deep: a recursive measure would overflow on every runtime.
    let e: Expression = { kind: 'nop' } as Expression;
    for (let i = 0; i < 1_000_000; i++) {
      e = { kind: 'block', children: [e], label: '', loc: undefined } as unknown as Expression;
    }
    assertEquals(nestingDepth(e), 1_000_001);
    assertEquals(nestingDepth(e, 300) > 300, true);
  });
});
