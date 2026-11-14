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

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { wasm2wat } from '../../../src/tools/wasm2wat.ts';
import { wasmValidate } from '../../../src/tools/wasm-validate.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { Interpreter, Stop } from '../../../src/interp/interpreter.ts';
import { formatErrors } from '../../../src/core/error.ts';
import {
  MAX_NESTING_DEPTH,
  moduleLimitProblem,
  NESTING_OVER_LIMIT,
  nestingDepth,
  NestingLimitError,
  SUBTREE_SHARED,
} from '../../../src/ir/nesting.ts';
import { defaultPassOptions, PassRunner } from '../../../src/passes/pass.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import { BinaryOp, type Expression, makeBinary, makeConst } from '../../../src/ir/expressions.ts';
import { ValType } from '../../../src/ir/types.ts';

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
// 719 ms at k = 24 and would never finish at k = 40, and one such subtree as the body of many
// functions ran the writer to 6.9 GB. A cap on nodes AS WALKED (the first fix) was per function,
// so the retest beat it across functions. Now any expression met twice anywhere in the module is
// refused (SUBTREE_SHARED), as upstream's validator refuses it, in one walk over each DISTINCT node.
describe('one tree — a subtree shared by reference is refused, at once', () => {
  /** `k` levels, each an `i32.add` whose two operands are the SAME node. */
  const dag = (k: number): Expression => {
    let e = readWat('(module (func (drop (i32.const 1))))').functions[0]!.body.children[0]!;
    e = (e as { value: Expression }).value;
    for (let i = 0; i < k; i++) e = { kind: 'binary', op: 0x6a, left: e, right: e } as never;
    return e;
  };
  /** `n` functions, each `(drop <body>)`. */
  const moduleOf = (body: () => Expression, n = 1) => {
    const m = readWat(`(module ${'(func (drop (i32.const 0))) '.repeat(n)}(export "f" (func 0)))`);
    for (const f of m.functions) (f.body.children[0]! as { value: Expression }).value = body();
    return m;
  };
  /** What each stage that throws says about `m`. */
  const refusals = (m: ReturnType<typeof moduleOf>) => {
    const msg = (f: () => unknown) => {
      try {
        f();
        return 'accepted';
      } catch (x) {
        return String((x as Error).message);
      }
    };
    return {
      check: moduleLimitProblem(m) ?? 'accepted',
      write: msg(() => writeWasm(m)),
      passes: msg(() => new PassRunner(m, defaultPassOptions).add('Vacuum').run()),
      interp: msg(() => new Interpreter(m)),
    };
  };

  it('k = 40 (2^40 nodes as walked) is refused at once, at every stage that throws', () => {
    const m = moduleOf(() => dag(40));
    const t = performance.now();
    const r = refusals(m);
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
    assertEquals(r.check, SUBTREE_SHARED);
    assertEquals(r.write, SUBTREE_SHARED);
    assertEquals(r.passes, `optimizer: ${SUBTREE_SHARED}`);
    assertEquals(r.interp, `unsupported: ${SUBTREE_SHARED}`);
  });

  it("ONE shared subtree as the body of 400 functions — the retest's case — is refused at once", () => {
    const shared = dag(21);
    const m = moduleOf(() => shared, 400);
    const t = performance.now();
    assertEquals(refusals(m).check, SUBTREE_SHARED);
    assert(performance.now() - t < 2_000, `${performance.now() - t} ms`);
  });

  it('a node shared between two functions but not within either is refused too', () => {
    const one =
      (readWat('(module (func (drop (i32.const 5))))').functions[0]!.body.children[0]! as {
        value: Expression;
      }).value;
    const m = moduleOf(() => one, 2);
    assertEquals(refusals(m).write, SUBTREE_SHARED);
  });

  it('a cycle is refused, not walked forever', () => {
    const a = { kind: 'binary', op: 0x6a } as unknown as { left: unknown; right: unknown };
    a.left = a;
    a.right = a;
    assertEquals(refusals(moduleOf(() => a as unknown as Expression)).check, SUBTREE_SHARED);
  });

  it('distinct nodes — however many, however alike — are a tree, and pass', () => {
    // dag-shaped but every node its own object (built by the factories): no sharing.
    const tree = (k: number): Expression =>
      k === 0
        ? makeConst({ type: ValType.I32, value: 1 })
        : makeBinary(BinaryOp.AddI32, tree(k - 1), tree(k - 1));
    const m = moduleOf(() => tree(10), 3);
    assertEquals(refusals(m), {
      check: 'accepted',
      write: 'accepted',
      passes: 'accepted',
      interp: 'accepted',
    });
    const wide = readWat(`(module (func ${'(nop) '.repeat(1_000_000)}))`);
    assertEquals(moduleLimitProblem(wide), undefined);
  });

  it('the reader and the parser, which cannot share a node, keep the cheaper depth-only walk', () => {
    assertEquals(nestingDepth(dag(3)), 4);
    assertEquals(nestingDepth(dag(3), Infinity, new Set()), -1);
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
