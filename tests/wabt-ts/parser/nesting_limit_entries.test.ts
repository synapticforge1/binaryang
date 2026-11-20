// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The nesting limit (MAX_NESTING_DEPTH, 256) at the entries security review round 3 found open
// (hardening C-H2 … C-H5, 2026-11-20): each is held at exactly 256, refused at 257 and at
// 100,000 — in the limit's one line, never the host's stack. `nesting_limit.test.ts` holds the
// first round's stages; this holds
//   - the WAT parser's three shapes the token pre-scan miscounted: `(@metadata.code…` annotations,
//     the folded `delegate`, and a linear operand chain (nested with no parenthesis at all);
//   - `parseWastScript`: a text module inside a script, and the script's own nested commands;
//   - the entries that took a module nobody had measured: `createPass().run`, `resolveNames`,
//     `validateModule`, `ExprVisitor`;
//   - a PASS that deepens a module (Inlining nests a callee inside the call site's blocks);
//   - the interpreter, whose blocks and calls share one host stack;
//   - the unit: what counts as a level (README says the same).

import { describe, it } from 'node:test';
import { assert, assertEquals } from '@std/assert';
import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import { readWat } from '../../../src/tools/read-wat.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/core/error.ts';
import { parseWastScript, parseWatModule } from '../../../src/parser/wast-parser.ts';
import {
  MAX_NESTING_DEPTH,
  NESTING_OVER_LIMIT,
  nestingDepth,
  NestingLimitError,
} from '../../../src/ir/nesting.ts';
import { Result } from '../../../src/core/result.ts';
import { resolveNames } from '../../../src/ir/resolve-names.ts';
import { validateModule } from '../../../src/validator/validator.ts';
import { ExprVisitor, NopDelegate } from '../../../src/ir/expr-visitor.ts';
import { createPass, defaultPassOptions, type Pass, PassRunner } from '../../../src/passes/pass.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import '../../../src/passes/index.ts';
import type { Expression } from '../../../src/ir/expressions.ts';
import { Interpreter, Stop, Trap } from '../../../src/interp/interpreter.ts';
import { ValType } from '../../../src/ir/types.ts';

const N = MAX_NESTING_DEPTH;
const DEEP = 100_000;

/** The text of `errors`, which must be exactly the limit's one line. */
function assertRefused(errors: Parameters<typeof formatErrors>[0], what: string): void {
  const text = formatErrors(errors);
  assertEquals(errors.length, 1, `${what}: ${text}`);
  assert(text.includes(NESTING_OVER_LIMIT), `${what}: ${text}`);
}

/** `make(n)` compiles at depth N and is refused, in one line, one level past it and at 100,000. */
function heldAt(shape: string, make: (depth: number) => string): void {
  it(`${shape}: ${N} deep compiles; ${N + 1} and ${DEEP} are the one-line refusal`, () => {
    const ok = wat2wasm(make(N));
    assertEquals(ok.errors.length, 0, formatErrors(ok.errors));
    for (const d of [N + 1, DEEP]) assertRefused(wat2wasm(make(d)).errors, `${shape} at ${d}`);
  });
}

describe('C-H3 — the WAT parser: shapes the token pre-scan miscounted', () => {
  // `(@metadata.code.x "d")` is a token (LparAnn) whose `)` the pre-scan counted but whose `(` it
  // did not: each one hid a level, so 100,000 nested blocks with one annotation each reached the
  // recursive parser (it came back as "the JavaScript call stack ran out"). The innermost block
  // holds the annotation as a child, one level under it: n blocks are n + 1 deep.
  heldAt(
    'annotations: folded blocks, each with a (@metadata.code …)',
    (d) => `(module (func ${'(block (@metadata.code.x "d") '.repeat(d - 1)}${')'.repeat(d - 1)}))`,
  );

  // The folded `(delegate $l)` closes only its own parenthesis; the pre-scan let it close a
  // LINEAR level too, so `block (try (do) (delegate 0))` repeated hid every `block`.
  heldAt(
    'folded delegate between linear blocks',
    (d) =>
      `(module (func ${'block (try (do) (delegate 0)) '.repeat(d - 1)}${'end '.repeat(d - 1)}))`,
  );

  // A linear operand chain nests without a parenthesis or a block keyword: the pre-scan has
  // nothing to count, the built tree is what is deep, and the parser walked it (the implicit
  // types' ExprVisitor, the label scopes) before anything judged it. `drop` + k adds + a
  // constant: k + 2 deep.
  heldAt(
    'linear operand chain',
    (d) => `(module (func ${'i32.const 1 '.repeat(d - 1)}${'i32.add '.repeat(d - 2)} drop))`,
  );

  // The same chain as a global initialiser and a segment offset (extended-const).
  heldAt(
    'linear operand chain in a global initialiser',
    (d) => `(module (global i32 ${'i32.const 1 '.repeat(d)}${'i32.add '.repeat(d - 1)}))`,
  );

  // A `(then`, `(else`, `(do` and `(catch` group opens a LIST, not a level: the pre-scan counted
  // them, so a folded text nest of ifs or trys was refused at ~136 levels where the binary route
  // takes 256 (C-H5). The innermost `if` has its condition under it: `d - 1` ifs are d deep.
  heldAt(
    'folded ifs (then-arms)',
    (d) =>
      `(module (func (export "f") ${'(if (i32.const 0) (then '.repeat(d - 1)}${
        '))'.repeat(d - 1)
      }))`,
  );
  heldAt(
    'folded ifs (else-arms)',
    (d) =>
      `(module (func (export "f") ${'(if (i32.const 0) (then (nop)) (else '.repeat(d - 1)}${
        '))'.repeat(d - 1)
      }))`,
  );
  heldAt(
    'folded loops',
    (d) => `(module (func (export "f") ${'(loop '.repeat(d)}${')'.repeat(d)}))`,
  );
  heldAt(
    'folded trys (do-bodies)',
    (d) => `(module (func (export "f") ${'(try (do '.repeat(d)}${'))'.repeat(d)}))`,
  );
  heldAt(
    'folded trys (catch_all bodies)',
    (d) =>
      `(module (func (export "f") ${'(try (do (nop)) (catch_all '.repeat(d - 1)}${
        '))'.repeat(d - 1)
      }))`,
  );

  it('a (@name …)/(@custom …) nest, and an annotation the lexer skips: no recursion, no overflow', () => {
    // The skipped ones are never tokens, so nothing recurses; the recognised ones nest as
    // errors, not levels. Measured at 100,000 on V8 and JSC: an answer, never a stack overflow.
    const skipped = `(module (func (@foo ${'(@bar '.repeat(DEEP)}${')'.repeat(DEEP)}) nop))`;
    assertEquals(wat2wasm(skipped).errors.length, 0);
    const recognised = `(module (@custom "a" ${'(@custom "a" '.repeat(DEEP)}${')'.repeat(DEEP)}))`;
    const r = wat2wasm(recognised);
    assert(hasErrors(r.errors));
    assert(!formatErrors(r.errors).includes('call stack'), formatErrors(r.errors).slice(0, 200));
  });
});

describe('C-H4 — parseWastScript', () => {
  const chainModule = (d: number) =>
    `(module (func ${'i32.const 1 '.repeat(d - 1)}${'i32.add '.repeat(d - 2)} drop))`;
  const foldedModule = (d: number) =>
    `(module (func (drop ${'(i32.add '.repeat(d - 2)}(i32.const 0)${
      ' (i32.const 1))'.repeat(d - 2)
    })))`;

  /** Held at N, refused in one line at N + 1 and 100,000, with no command kept. */
  const script = (shape: string, make: (d: number) => string) =>
    it(`${shape}: ${N} deep is parsed; ${N + 1} and ${DEEP} are the one-line refusal`, () => {
      const ok = parseWastScript(make(N));
      assertEquals(ok.errors.length, 0, formatErrors(ok.errors));
      assert(ok.script.commands.length > 0);
      for (const d of [N + 1, DEEP]) {
        const r = parseWastScript(make(d));
        assertRefused(r.errors, `${shape} at ${d}`);
        assertEquals(r.script.commands.length, 0);
      }
    });

  script('a text module, linear chain', chainModule);
  script('a text module, folded chain', foldedModule);
  script(
    'a module inside assert_invalid',
    (d) => `(assert_invalid ${foldedModule(d)} "type mismatch")`,
  );

  it("the script's own nested commands, args and results at 100,000: the one-line refusal", () => {
    const shapes: Record<string, string> = {
      assert_trap: `${'(assert_trap '.repeat(DEEP)}(invoke "f")${' "x")'.repeat(DEEP)}`,
      invoke: `(assert_return (invoke "f" ${'(i32.const 1 '.repeat(DEEP)}${')'.repeat(DEEP)}))`,
      either: `(assert_return (invoke "f") ${'(either '.repeat(DEEP)}(i32.const 1)${
        ')'.repeat(DEEP)
      })`,
      ref: `(assert_return (invoke "f") ${'(ref.null '.repeat(DEEP)}${')'.repeat(DEEP)})`,
      register: `${'(register "a" '.repeat(DEEP)}${')'.repeat(DEEP)}`,
    };
    for (const [name, text] of Object.entries(shapes)) {
      const r = parseWastScript(text);
      assertRefused(r.errors, name);
      assertEquals(r.script.commands.length, 0, name);
    }
  });

  it('a script of 256-deep modules, many of them, is parsed', () => {
    const r = parseWastScript(`${chainModule(N)}\n${foldedModule(N)}\n${chainModule(N)}`);
    assertEquals(r.errors.length, 0, formatErrors(r.errors));
    assertEquals(r.script.commands.length, 3);
  });
});

/**
 * A module built the way an API user builds one: read at exactly the limit, then made `extra`
 * levels deeper in the IR (0: as read, N deep).
 */
function deepened(extra: number) {
  const m = readWat(`(module (func (export "f") ${'(block '.repeat(N)}${')'.repeat(N)}))`);
  let e: Expression = m.functions[0]!.body.children[0]!;
  while (e.kind === 'block' && e.children.length > 0) e = e.children[0]!;
  if (extra === 0) return m;
  let inner: Expression = { kind: 'nop' } as Expression;
  for (let i = 1; i < extra; i++) {
    inner = {
      kind: 'block',
      children: [inner],
      label: '',
      loc: undefined,
    } as unknown as Expression;
  }
  (e as { children: Expression[] }).children = [inner];
  return m;
}

describe('C-H4 — entries given a module nobody measured', () => {
  /** The refusal each public entry gives for `m`, or 'accepted'. */
  const entries = (m: ReturnType<typeof deepened>) => {
    const out: Record<string, string> = {};
    const attempt = (name: string, f: () => string) => {
      try {
        out[name] = f();
      } catch (e) {
        out[name] = e instanceof NestingLimitError ? 'limit' : `THROWN ${String(e).slice(0, 80)}`;
      }
    };
    attempt('createPass().run', () => {
      createPass('Vacuum').run(m, defaultPassOptions);
      return 'accepted';
    });
    attempt('resolveNames', () => {
      const errors = makeErrorList();
      const r = resolveNames(m, errors);
      return r === Result.Error && formatErrors(errors).includes(NESTING_OVER_LIMIT)
        ? 'limit'
        : `result ${r}: ${formatErrors(errors)}`;
    });
    attempt('validateModule', () => {
      const errors = makeErrorList();
      const r = validateModule(m, errors);
      return r === Result.Error && formatErrors(errors).includes(NESTING_OVER_LIMIT)
        ? 'limit'
        : `result ${r}: ${formatErrors(errors)}`;
    });
    attempt('ExprVisitor.visitFunc', () => {
      new ExprVisitor(new NopDelegate()).visitFunc(m.functions[0]!);
      return 'accepted';
    });
    attempt('ExprVisitor.visitExprList', () => {
      new ExprVisitor(new NopDelegate()).visitExprList(m.functions[0]!.body.children);
      return 'accepted';
    });
    return out;
  };

  it(`a module exactly ${N} deep is taken by every entry`, () => {
    const m = deepened(0);
    assertEquals(nestingDepth(m.functions[0]!.body), N);
    for (const [name, v] of Object.entries(entries(m))) {
      assert(v === 'accepted' || v.startsWith('result 0'), `${name}: ${v}`);
    }
  });

  it(`${N + 1} deep is refused by every entry, in the limit's words`, () => {
    const m = deepened(1);
    assertEquals(nestingDepth(m.functions[0]!.body), N + 1);
    for (const [name, v] of Object.entries(entries(m))) assertEquals(v, 'limit', name);
  });

  it(`${DEEP} deep, built through the API, is refused by every entry — no host stack overflow`, () => {
    const m = deepened(DEEP);
    for (const [name, v] of Object.entries(entries(m))) assertEquals(v, 'limit', name);
  });

  it('the ExprVisitor counts a code-metadata annotation as a level, as nestingDepth does', () => {
    // An annotation in the innermost list of N - 1 blocks is the Nth level: held. In N blocks it
    // is the N + 1th: refused (it was walked uncounted, so this one passed).
    const annotation = { kind: 'code_metadata', name: 'x', data: new Uint8Array(1) } as unknown;
    const nest = (blocks: number): Expression => {
      let e = { kind: 'block', children: [annotation], label: '', loc: undefined } as unknown;
      for (let i = 1; i < blocks; i++) {
        e = { kind: 'block', children: [e], label: '', loc: undefined };
      }
      return e as Expression;
    };
    new ExprVisitor(new NopDelegate()).visitExpr(nest(N - 1));
    let thrown: unknown;
    try {
      new ExprVisitor(new NopDelegate()).visitExpr(nest(N));
    } catch (x) {
      thrown = x;
    }
    assert(thrown instanceof NestingLimitError, String(thrown));
    assertEquals(nestingDepth(nest(N)), N + 1);
  });

  it('the ExprVisitor counts the levels it walks, so a delegate that recurses is held too', () => {
    // A tree the entry checks never saw: handed straight to the visitor.
    let e: Expression = { kind: 'nop' } as Expression;
    for (let i = 1; i < N; i++) {
      e = { kind: 'block', children: [e], label: '', loc: undefined } as unknown as Expression;
    }
    new ExprVisitor(new NopDelegate()).visitExpr(e); // N deep: fine
    e = { kind: 'block', children: [e], label: '', loc: undefined } as unknown as Expression;
    let thrown: unknown;
    try {
      new ExprVisitor(new NopDelegate()).visitExpr(e);
    } catch (x) {
      thrown = x;
    }
    assert(thrown instanceof NestingLimitError, String(thrown));
    // …and the same visitor is usable again after a refusal.
    const v = new ExprVisitor(new NopDelegate());
    try {
      v.visitExpr(e);
    } catch {
      // refused, as above
    }
    v.visitExpr({ kind: 'nop' } as Expression);
  });
});

describe('C-H2 — a pass that deepens a module', () => {
  /** f0 → f1 → … : each called once, each `k` blocks deep with its call at the deepest point. */
  const chain = (k: number, length: number) =>
    `(module ${
      Array.from({ length }, (_, i) =>
        `(func $f${i} ${i === 0 ? '(export "f")' : ''} ${'(block '.repeat(k)}${
          i + 1 < length ? `(call $f${i + 1})` : '(nop)'
        }${')'.repeat(k)})`).join('\n')
    })`;
  const depthOf = (m: ReturnType<typeof readWat>) =>
    Math.max(...m.functions.map((f) => nestingDepth(f.body)));

  it('Inlining leaves a function it would take past the limit as it was: 2 × 200 levels, 8 × 250', () => {
    // Inlining puts the callee's body inside the call site's blocks: 200 + 200 = 400 deep, and a
    // chain of 8 single-caller functions 250 deep each is 2,000 — which ran the NEXT walker out
    // of the host's stack on V8 (a bare "ran out of stack" error) and was a limit refusal on JSC.
    for (const [k, length] of [[200, 2], [250, 8]] as const) {
      const m = readWat(chain(k, length));
      assert(depthOf(m) <= N, `the input is within the limit: ${depthOf(m)}`);
      new PassRunner(m, { ...defaultPassOptions, optimizeLevel: 2 }).add('Inlining').run();
      assertEquals(
        m.functions.length,
        length,
        `${k}×${length}: nothing was inlined into a deeper site`,
      );
      assert(depthOf(m) <= N, `${k}×${length}: ${depthOf(m)}`);
      writeWasm(m); // and the writers take what the pass left
    }
  });

  it('a chain whose inlined result stays within the limit is inlined as before', () => {
    const m = readWat(chain(100, 2)); // 201 deep once inlined
    new PassRunner(m, { ...defaultPassOptions, optimizeLevel: 2 }).add('Inlining').run();
    assertEquals(m.functions.length, 1);
    assertEquals(depthOf(m), 202);
  });

  it('the full -O2 pipeline takes the deep chain: no pass is handed a tree past the limit', () => {
    const m = readWat(chain(250, 8));
    new PassRunner(m, { ...defaultPassOptions, optimizeLevel: 2, shrinkLevel: 0 })
      .addDefaultOptimizationPasses().run();
    assert(depthOf(m) <= N, String(depthOf(m)));
    writeWasm(m);
  });

  it('any other pass that deepens a module is refused right after it, not in the next one', () => {
    const wrap = (name: string, levels: number): Pass => ({
      name,
      description: 'wraps every function body in blocks',
      requiresNonNullableLocalFixups: false,
      run(module) {
        for (const f of module.functions) {
          let e: Expression = f.body.children[0]!;
          for (let i = 0; i < levels; i++) {
            e = {
              kind: 'block',
              children: [e],
              label: '',
              loc: undefined,
            } as unknown as Expression;
          }
          (f.body as { children: Expression[] }).children = [e];
        }
      },
    });
    const body = `(module (func (export "f") ${'(block '.repeat(N - 2)}(nop)${')'.repeat(N - 2)}))`;
    // Up to the limit exactly: fine.
    new PassRunner(readWat(body), defaultPassOptions).addPass(wrap('Wrap1', 1)).run();
    // One past: refused after THAT pass — before the next one runs.
    const m = readWat(body);
    let ranNext = false;
    const next: Pass = { ...wrap('Next', 0), run: () => void (ranNext = true) };
    let thrown: unknown;
    try {
      new PassRunner(m, defaultPassOptions).addPass(wrap('Wrap2', 2)).addPass(next).run();
    } catch (e) {
      thrown = e;
    }
    assert(thrown instanceof NestingLimitError, String(thrown));
    assert(
      (thrown as Error).message.startsWith('optimizer (after Wrap2): '),
      (thrown as Error).message,
    );
    assert((thrown as Error).message.includes(NESTING_OVER_LIMIT));
    assertEquals(ranNext, false);
  });
});

describe('C-H2 — the interpreter: blocks and calls share one host stack', () => {
  // `f(d)` recurses d calls deep, each call inside `k` nested blocks. The host recursion is
  // about (calls × blocks per call): measured 2026-11-20, the same program runs on JSC and is a
  // Stop on V8 (and on V8 at a different place when cold or warm). The contract is not WHERE it
  // ends but HOW: the right answer, or a Stop — never a bare RangeError, and never the program's
  // own trap `call stack exhausted` before its own limit (`maxDepth`, 1,000 calls).
  const recursive = (k: number) =>
    `(module (func $f (export "f") (param i32) (result i32)
       ${'(block '.repeat(k)}
       (br_if 0 (i32.eqz (local.get 0)))
       (drop (call $f (i32.sub (local.get 0) (i32.const 1))))
       ${')'.repeat(k)}
       (i32.const 7)))`;
  const outcome = (k: number, d: number): string => {
    const m = readForPasses(wat2wasm(recursive(k), { textForm: false }).binary);
    try {
      const r = new Interpreter(m).invoke('f', [{ type: ValType.I32, value: d }]);
      return r.length === 1 && (r[0] as { value: number }).value === 7 ? 'ok' : 'WRONG';
    } catch (e) {
      if (e instanceof Stop) return `stop: ${e.message}`;
      if (e instanceof Trap) return `trap: ${e.message}`;
      return `RAW ${String(e).slice(0, 80)}`;
    }
  };

  it('every depth of calls × blocks ends in the answer or a Stop, never RAW or an early trap', () => {
    for (const k of [1, 100, 250]) {
      for (const d of [10, 100, 400, 900, 999]) {
        const o = outcome(k, d);
        assert(o === 'ok' || o.startsWith('stop: '), `k=${k} d=${d}: ${o}`);
        if (o.startsWith('stop: ')) {
          assert(
            o.includes('ran out of its host') || o.includes('JavaScript call stack ran out'),
            `k=${k} d=${d}: ${o}`,
          );
        }
      }
    }
  });

  it('past its own limit (1,000 calls) the program traps, or the host ended the run first: a Stop', () => {
    const o = outcome(1, 1100);
    assert(o === 'trap: call stack exhausted' || o.startsWith('stop: '), o);
  });
});

describe('C-H5 — the unit: what counts as a level', () => {
  /** The depth of the first function's body as the parser builds it (folded or not). */
  const depth = (body: string, extra = ''): number => {
    const r = parseWatModule(`(module ${extra} (func ${body}))`);
    assertEquals(r.errors.length, 0, formatErrors(r.errors));
    return nestingDepth(r.module.functions[0]!.body);
  };

  it('every expression node on a path is one level: block, loop, if, try, try_table, operands', () => {
    assertEquals(depth('nop'), 1);
    assertEquals(depth('(block (block (block)))'), 3);
    assertEquals(depth('(block (loop (nop)))'), 3);
    assertEquals(depth('(drop (i32.add (i32.const 0) (i32.const 1)))'), 3);
    // An if: the condition is one level under it; an arm is a list, not a level.
    assertEquals(depth('(if (i32.const 1) (then (nop)))'), 2);
    assertEquals(depth('(if (i32.const 1) (then (block (nop))) (else (nop)))'), 3);
    // A try: its body and a catch body are lists; the nodes in them are one level under the try.
    assertEquals(depth('(try (do (nop)) (catch_all (block (nop))))'), 3);
    assertEquals(
      depth('(block $b (try_table (catch_all 0) (nop)))'),
      3,
    );
    // A code-metadata annotation is a node, one level under what holds it.
    assertEquals(depth('(block (@metadata.code.x "d"))'), 2);
  });

  it('how a level was written does not matter: folded, linear and an unparenthesised chain agree', () => {
    assertEquals(depth('(block (block (block)))'), depth('block block block end end end'));
    assertEquals(
      depth('(drop (i32.add (i32.const 0) (i32.const 1)))'),
      depth('i32.const 0 i32.const 1 i32.add drop'),
    );
    assertEquals(
      depth('(drop (i32.add (i32.add (i32.const 0) (i32.const 1)) (i32.const 2)))'),
      depth('i32.const 0 i32.const 1 i32.add i32.const 2 i32.add drop'),
    );
  });

  it('a global initialiser counts the same: its first expression is level 1', () => {
    const r = parseWatModule('(module (global i32 (i32.add (i32.const 1) (i32.const 2))))');
    assertEquals(nestingDepth(r.module.globals[0]!.init!), 2);
  });

  it('README states the unit, naming the same constructs', async () => {
    const readme = await (await import('../../test_fs.ts')).readTextFile('README.md');
    const at = readme.indexOf('**The unit:**');
    assert(at > 0, 'README has "The unit:"');
    const text = readme.slice(at, at + 2_000);
    for (const word of ['block', 'loop', 'if', 'try', 'try_table', 'operand', 'condition', 'arm']) {
      assert(text.includes(word), `README's unit paragraph names ${word}`);
    }
  });
});

describe('F2 — a malformed nest of region openers is refused cheaply, and no input makes output quadratic', () => {
  // Hardening F2 (4.1.x review): the pre-scan stopped counting `(do`, `(catch …`, `(catch_all`,
  // `(then` and `(else` (C-H5), so `(try (do) (catch_all (catch_all …` reached the parser: one
  // "expected ), got (" per token, and the long format quoted the whole line for each — 140 MB
  // and 5.7 s at 2,000, over 106 s at 20,000. A region opener directly inside another is
  // malformed and counts as a level again; `formatErrors` is bounded in both its dimensions.
  const shapes: Record<string, (n: number) => string> = {
    'catch_all in catch_all': (n) =>
      `(module (func (try (do) ${'(catch_all '.repeat(n)}${')'.repeat(n)})))`,
    'do in do': (n) => `(module (func (try ${'(do '.repeat(n)}${')'.repeat(n)})))`,
    'catch $t in catch $t': (n) =>
      `(module (tag $t) (func (try (do) ${'(catch $t '.repeat(n)}${')'.repeat(n)})))`,
    'then in then': (n) =>
      `(module (func (if (i32.const 0) ${'(then '.repeat(n)}${')'.repeat(n)})))`,
    'else in else': (n) =>
      `(module (func (if (i32.const 0) (then) ${'(else '.repeat(n)}${')'.repeat(n)})))`,
  };
  for (const [name, make] of Object.entries(shapes)) {
    for (const n of [2000, DEEP]) {
      it(`${name} x ${n}: the limit's one line, in under 2 s, bounded output`, () => {
        const text = make(n);
        const t0 = performance.now();
        const r = wat2wasm(text, { filename: 'c.wat' });
        const out = formatErrors(r.errors, 'long', text);
        const ms = performance.now() - t0;
        assert(ms < 2000, `${ms} ms`);
        assert(out.length < 20_000, `${out.length} characters`);
        assertRefused(r.errors, name);
      });
    }
  }

  it('formatErrors prints at most 100 errors, then counts the rest', () => {
    const loc = { filename: 'x.wat', line: 1, column: 1, offset: 0, endColumn: 2 };
    const list = makeErrorList();
    for (let i = 0; i < 100_000; i++) list.push({ loc, message: 'm', level: 1 });
    const out = formatErrors(list, 'long', '(x)');
    assertEquals(out.split('\n').filter((l) => l.includes('error: m')).length, 100);
    assert(out.endsWith('... 99900 more errors'), out.slice(-60));
    assert(out.length < 20_000, String(out.length));
    // Under the cap nothing is added.
    assert(!formatErrors(list.slice(0, 100)).includes('more error'));
  });

  it('formatErrors quotes a bounded window of a long line, the caret under the token', () => {
    const line = `${'a '.repeat(50_000)}TOKEN${' b'.repeat(50_000)}`;
    const column = line.indexOf('TOKEN') + 1;
    const loc = { filename: 'x.wat', line: 1, column, offset: 0, endColumn: column + 5 };
    const out = formatErrors([{ loc, message: 'm', level: 1 }], 'long', line);
    const [, quoted, caret] = out.split('\n');
    assert(out.length < 1000, String(out.length));
    assert(quoted!.startsWith('\u2026') && quoted!.endsWith('\u2026'), quoted);
    assertEquals(caret!.indexOf('^'), quoted!.indexOf('TOKEN'));
    assertEquals(caret!.trimStart().length, 5);
    // A line within the bound prints whole, as ever.
    const short = formatErrors(
      [{ loc: { ...loc, column: 3, endColumn: 8 }, message: 'm', level: 1 }],
      'long',
      'ab TOKEN cd',
    );
    assertEquals(short, 'x.wat:1:3: error: m\nab TOKEN cd\n  ^^^^^');
  });
});
