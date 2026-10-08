// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 23, E3a: the interpreter's core — numbers, locals, globals,
// control, calls. `deno task interp` runs it against the whole spec testsuite;
// these are the cases that suite does not pin by itself or that CI must see
// without the prepared corpus: the stack-machine shapes the byte-faithful
// reader leaves (a value under a branch, a block parameter taken by `pop`), the
// two ways to stop, and a shared mutable global.
//
// Each result is checked against V8 running the same bytes — the engine is the
// oracle, not what this file expects.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { readForPasses } from '../../../src/binaryen-ts/ir/prepare.ts';
import {
  Interpreter,
  Stop,
  Trap,
  type Value,
  WasmException,
} from '../../../src/binaryen-ts/interp/interpreter.ts';
import { ValType } from '../../../src/binaryen-ts/ir/types.ts';

const i32 = (value: number): Value => ({ type: ValType.I32, value });

function interp(wat: string, options = {}) {
  return new Interpreter(readForPasses(wat2wasm(wat, { textForm: false }).binary), options);
}
/** `f(...args)` on the interpreter and on V8: the same i32 result, or both trap. */
async function agree(wat: string, ...args: number[]): Promise<number | string> {
  const bytes = wat2wasm(wat, { textForm: false }).binary;
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource);
  let engine: number | string;
  try {
    engine = (instance.exports.f as (...a: number[]) => number)(...args);
  } catch (e) {
    // An uncaught wasm exception is not a trap, on either side.
    engine = e instanceof WebAssembly.Exception ? 'exception' : `trap: ${(e as Error).message}`;
  }
  let ours: number | string;
  try {
    const [r] = interp(wat).invoke('f', args.map(i32));
    ours = r!.type === ValType.I32 ? r!.value : NaN;
  } catch (e) {
    if (e instanceof WasmException) ours = 'exception';
    else if (e instanceof Trap) ours = `trap: ${e.message}`;
    else throw e;
  }
  expect(typeof ours === 'string').toBe(typeof engine === 'string');
  expect(ours === 'exception').toBe(engine === 'exception');
  if (typeof ours === 'number') expect(ours).toBe(engine);
  return ours;
}

describe('control', () => {
  it('a branch carries the values its target takes, from wherever they are', async () => {
    for (const x of [0, 1, 5]) {
      await agree(
        `(module (func (export "f") (param i32) (result i32)
          (block $b (result i32)
            (i32.const 10)
            (br_if $b (local.get 0))
            (drop)
            (i32.const 20))))`,
        x,
      );
    }
  });

  it('br_table, every target and the default', async () => {
    for (const x of [0, 1, 2, 3, -1]) {
      await agree(
        `(module (func (export "f") (param i32) (result i32)
          (block $c (block $b (block $a (br_table $a $b $c (local.get 0)))
            (return (i32.const 1))) (return (i32.const 2))) (i32.const 3)))`,
        x,
      );
    }
  });

  it('a loop counts, its back edge carrying nothing', async () => {
    await agree(
      `(module (func (export "f") (param i32) (result i32) (local i32)
        (loop $l
          (local.set 1 (i32.add (local.get 1) (local.get 0)))
          (br_if $l (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
        (local.get 1)))`,
      10,
    );
  });

  it('a loop with a parameter: the back edge carries it', async () => {
    await agree(
      `(module (func (export "f") (param i32) (result i32)
        (i32.const 0)
        (loop $l (param i32) (result i32)
          (i32.add (local.get 0))
          (br_if $l (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))))`,
      6,
    );
  });

  it('an if with a parameter, and a label something leaves by', async () => {
    for (const x of [0, 1, 2]) {
      await agree(
        `(module (func (export "f") (param i32) (result i32)
          (i32.const 7)
          (if $i (param i32) (result i32) (local.get 0)
            (then (br_if $i (i32.eq (local.get 0) (i32.const 2))) (i32.const 3) (i32.mul))
            (else (i32.const 100) (i32.add)))))`,
        x,
      );
    }
  });

  it("a value BELOW a block's parameters is still there after it", async () => {
    // A block with a parameter starts its frame under that parameter. Get the
    // frame's base wrong and the block's own result is still right — only the
    // value beneath it, read after the block, shows it (a mutant that ignored
    // the parameter count passed every other test and the whole spec suite).
    await agree(
      `(module (func (export "f") (result i32)
        (i32.const 100) (i32.const 1)
        (block (param i32) (result i32) (i32.const 2) (i32.add))
        (i32.add)))`,
    );
    for (const x of [0, 1]) {
      await agree(
        `(module (func (export "f") (param i32) (result i32)
          (i32.const 100) (i32.const 1)
          (if (param i32) (result i32) (local.get 0)
            (then (i32.const 2) (i32.add)) (else (i32.const 3) (i32.mul)))
          (i32.add)))`,
        x,
      );
    }
  });

  it('a multi-value call taken apart by its consumer', async () => {
    await agree(
      `(module
        (func $two (result i32 i32) (i32.const 9) (i32.const 4))
        (func (export "f") (result i32) (call $two) (i32.sub)))`,
    );
  });

  it('return from deep inside, and a branch to the function frame', async () => {
    for (const x of [0, 1]) {
      await agree(
        `(module (func (export "f") (param i32) (result i32)
          (block (block (if (local.get 0) (then (return (i32.const 5))))))
          (i32.const 6) (br 0)))`,
        x,
      );
    }
  });

  it("a trap, in the spec testsuite's words", async () => {
    expect(
      await agree(
        `(module (func (export "f") (result i32) (i32.div_s (i32.const 1) (i32.const 0))))`,
      ),
    )
      .toBe('trap: integer divide by zero');
    expect(await agree(`(module (func (export "f") (result i32) (unreachable)))`)).toBe(
      'trap: unreachable',
    );
  });
});

describe('calls and the stack', () => {
  it('recursion', async () => {
    await agree(
      `(module (func $fac (export "f") (param i32) (result i32)
        (if (result i32) (i32.eqz (local.get 0)) (then (i32.const 1))
          (else (i32.mul (local.get 0) (call $fac (i32.sub (local.get 0) (i32.const 1))))))))`,
      10,
    );
  });

  it('runaway recursion is "call stack exhausted", at the depth limit or the host\'s', () => {
    const wat = `(module (func $r (export "f") (result i32) (call $r)))`;
    for (const maxDepth of [50, 1_000_000]) {
      expect(() => interp(wat, { maxDepth }).invoke('f', [])).toThrow(Trap);
      try {
        interp(wat, { maxDepth }).invoke('f', []);
      } catch (e) {
        expect((e as Trap).message).toBe('call stack exhausted');
      }
    }
  });
});

describe('the two ways to stop, never a result', () => {
  it('a host function it was not given', () => {
    const wat =
      `(module (import "env" "h" (func $h (result i32))) (func (export "f") (result i32) (call $h)))`;
    expect(() => interp(wat).invoke('f', [])).toThrow(Stop);
    const given = interp(wat, { imports: () => ({ kind: 'func', call: () => [i32(42)] }) });
    expect(given.invoke('f', [])).toEqual([i32(42)]);
  });

  it('fuel', () => {
    const wat = `(module (func (export "f") (loop $l (br $l))))`;
    try {
      interp(wat, { fuel: 10_000 }).invoke('f', []);
      throw new Error('ran forever?');
    } catch (e) {
      expect(e).toBeInstanceOf(Stop);
      expect((e as Stop).reason).toBe('fuel');
    }
  });

  it('an instruction not run yet', () => {
    const wat =
      `(module (func (export "f") (result i32) (i32x4.extract_lane 0 (v128.const i32x4 1 2 3 4))))`;
    try {
      interp(wat).invoke('f', []);
      throw new Error('ran?');
    } catch (e) {
      expect(e).toBeInstanceOf(Stop);
      expect((e as Stop).reason).toBe('unsupported');
    }
  });
});

describe('globals', () => {
  it("an imported mutable global is the exporter's cell", () => {
    const a = interp(`(module (global (export "g") (mut i32) (i32.const 1))
      (func (export "get") (result i32) (global.get 0)))`);
    const b = interp(
      `(module (import "a" "g" (global (mut i32)))
        (func (export "set") (param i32) (global.set 0 (local.get 0))))`,
      { imports: () => ({ kind: 'global', cell: a.globalCell('g') }) },
    );
    b.invoke('set', [i32(241)]);
    expect(a.invoke('get', [])).toEqual([i32(241)]);
  });

  it('an initialiser reads an earlier global', () => {
    const m = interp(`(module (global $a i32 (i32.const 40))
      (global (export "b") i32 (i32.add (global.get $a) (i32.const 2))))`);
    expect(m.global('b')).toEqual(i32(42));
  });
});

describe('linear memory (E3b)', () => {
  const MEM = (body: string, params = '(param i32)') =>
    `(module (memory 1 3) (data (i32.const 8) "\\01\\80\\ff\\7f\\00\\00\\c0\\7f\\01\\00\\a0\\7f")
      (func (export "f") ${params} (result i32) ${body}))`;

  it('narrow loads, signed and unsigned, little-endian', async () => {
    for (const op of ['i32.load8_s', 'i32.load8_u', 'i32.load16_s', 'i32.load16_u', 'i32.load']) {
      for (const at of [8, 9, 10, 11]) await agree(MEM(`(${op} (local.get 0))`), at);
    }
    for (const op of ['i64.load8_s', 'i64.load16_u', 'i64.load32_s', 'i64.load32_u', 'i64.load']) {
      await agree(MEM(`(i32.wrap_i64 (i64.shr_u (${op} (local.get 0)) (i64.const 7)))`), 9);
    }
  });

  it('a narrow store writes only its low bytes', async () => {
    for (const op of ['i32.store8', 'i32.store16', 'i64.store8', 'i64.store32']) {
      const v = op.startsWith('i64') ? '(i64.const -2)' : '(i32.const -2)';
      await agree(MEM(`(${op} (i32.const 8) ${v}) (i32.load (i32.const 8))`, ''));
    }
  });

  it('a float keeps its NaN payload through a store and a load', async () => {
    // Bytes 14..17 hold the signalling NaN 0x7fa00001.
    await agree(
      MEM(`(f32.store (i32.const 0) (f32.load (i32.const 14))) (i32.load (i32.const 0))`, ''),
    );
    await agree(MEM(`(i32.reinterpret_f32 (f32.load (i32.const 14)))`, ''));
  });

  it('out of bounds: the last byte in, one past it out; the offset does not wrap', async () => {
    for (const at of [65532, 65533, 65535, -1]) await agree(MEM('(i32.load (local.get 0))'), at);
    for (const at of [0, 1, -4]) await agree(MEM('(i32.load offset=65532 (local.get 0))'), at);
  });

  it('memory.grow: the old size, then -1 past the maximum; memory.size follows', async () => {
    for (const d of [0, 1, 2, 3, -1]) {
      await agree(
        MEM('(i32.add (i32.mul (memory.grow (local.get 0)) (i32.const 100)) (memory.size))'),
        d,
      );
    }
    // Grown memory is zeroed and reachable.
    await agree(
      MEM(
        '(drop (memory.grow (i32.const 1))) (i32.store (i32.const 70000) (i32.const 5)) (i32.load (i32.const 70000))',
        '',
      ),
    );
  });

  it('memory.fill / memory.copy (overlapping both ways) / bounds', async () => {
    await agree(
      MEM(
        '(memory.fill (i32.const 8) (i32.const 0x1ab) (i32.const 3)) (i32.load (i32.const 8))',
        '',
      ),
    );
    for (const [d, s] of [[9, 8], [8, 9]]) {
      await agree(
        MEM(
          `(memory.copy (i32.const ${d}) (i32.const ${s}) (i32.const 4)) (i32.load (i32.const 8))`,
          '',
        ),
      );
    }
    for (const n of [0, 1]) {
      await agree(
        MEM('(memory.fill (i32.const 65536) (i32.const 1) (local.get 0)) (i32.const 7)'),
        n,
      );
    }
  });

  it('memory.init and data.drop', async () => {
    const wat = `(module (memory 1) (data $d "\\0a\\0b\\0c\\0d")
      (func (export "f") (param i32) (result i32)
        (if (local.get 0) (then (data.drop $d)))
        (memory.init $d (i32.const 0) (i32.const 1) (i32.const 3))
        (i32.load (i32.const 0))))`;
    for (const x of [0, 1]) await agree(wat, x);
  });

  it('an active segment is dropped once instantiation has written it', async () => {
    // memory.init from it: 0 bytes is fine, 1 byte is out of bounds.
    const wat = `(module (memory 1) (data $a (i32.const 0) "\\61\\62")
      (func (export "f") (param i32) (result i32)
        (memory.init $a (i32.const 4) (i32.const 0) (local.get 0))
        (i32.load (i32.const 0))))`;
    for (const n of [0, 1]) await agree(wat, n);
  });

  it("an imported memory is the exporter's cell", () => {
    const a = interp(
      `(module (memory (export "m") 1) (func (export "get") (result i32) (i32.load (i32.const 4))))`,
    );
    const b = interp(
      `(module (import "a" "m" (memory 1)) (data (i32.const 4) "\\2a")
        (func (export "grow") (result i32) (memory.grow (i32.const 1))))`,
      { imports: () => ({ kind: 'memory', cell: a.memoryCell('m') }) },
    );
    expect(a.invoke('get', [])).toEqual([i32(42)]);
    b.invoke('grow', []);
    expect(a.memoryCell('m').pages).toBe(2n);
  });

  it('a data segment out of bounds traps instantiation, after the ones before it', () => {
    const shared = interp(`(module (memory (export "m") 1))`).memoryCell('m');
    expect(() =>
      interp(
        `(module (import "a" "m" (memory 1)) (data (i32.const 0) "\\01") (data (i32.const 65536) "\\02"))`,
        {
          imports: () => ({ kind: 'memory', cell: shared }),
        },
      )
    ).toThrow(Trap);
    expect(shared.bytes[0]).toBe(1);
  });
});

describe('tables, references and indirect calls (E3c)', () => {
  const TABLE = `(module
    (type $ii (func (param i32) (result i32)))
    (type $v (func (result i32)))
    (table $t 4 8 funcref)
    (elem (table $t) (i32.const 0) func $double $seven)
    (elem $pass func $seven $double)
    (func $double (type $ii) (i32.mul (local.get 0) (i32.const 2)))
    (func $seven (type $v) (i32.const 7))`;

  it("call_indirect: a match, then each trap in the spec's order", async () => {
    const wat = `${TABLE}
      (func (export "f") (param i32) (result i32)
        (call_indirect $t (type $ii) (i32.const 21) (local.get 0))))`;
    // 0: $double; 1: $seven (type mismatch); 2: empty; 4: past the end; -1: past the end.
    for (const i of [0, 1, 2, 4, -1]) await agree(wat, i);
  });

  it('the bare prefix, and the slot, in "uninitialized element N"', () => {
    const m = interp(`${TABLE}
      (func (export "f") (param i32) (result i32)
        (call_indirect $t (type $v) (local.get 0))))`);
    expect(() => m.invoke('f', [i32(3)])).toThrow('uninitialized element 3');
  });

  it('table.get / set / size / grow / fill, and their bounds', async () => {
    const ops = [
      '(table.size $t)',
      '(table.grow $t (ref.null func) (local.get 0))',
      '(i32.add (table.grow $t (ref.func $seven) (local.get 0)) (table.size $t))',
      '(table.set $t (local.get 0) (ref.func $seven)) (call_indirect $t (type $v) (local.get 0))',
      '(ref.is_null (table.get $t (local.get 0)))',
      '(table.fill $t (local.get 0) (ref.func $seven) (i32.const 2)) (call_indirect $t (type $v) (i32.const 3))',
    ];
    for (const op of ops) {
      const wat = `${TABLE} (func (export "f") (param i32) (result i32) ${op}))`;
      for (const x of [0, 2, 3, 4, 5, -1]) await agree(wat, x);
    }
  });

  it('table.copy (overlapping both ways), table.init, elem.drop', async () => {
    // The table is [$double, $seven, null, null]. Slot d + 1 is where an
    // overlapping copy done naively forward differs: copying 0..1 to 1..2 must
    // leave $seven in slot 2, and a forward copy leaves $double there (a mutant
    // that did that passed the slot-d read this test made at first).
    for (const [d, s] of [[1, 0], [0, 1], [2, 0]]) {
      for (const read of [d, d + 1]) {
        await agree(`${TABLE} (func (export "f") (result i32)
          (table.copy $t $t (i32.const ${d}) (i32.const ${s}) (i32.const 2))
          (call_indirect $t (type $v) (i32.const ${read}))))`);
      }
    }
    const init = (drop: boolean, n: number) =>
      `${TABLE} (func (export "f") (result i32)
        ${drop ? '(elem.drop $pass)' : ''}
        (table.init $t $pass (i32.const 2) (i32.const 0) (i32.const ${n}))
        (call_indirect $t (type $v) (i32.const 2))))`;
    for (const drop of [false, true]) for (const n of [0, 1, 2]) await agree(init(drop, n));
  });

  it('an active element segment is dropped once written', async () => {
    await agree(
      `${TABLE} (elem $a (table $t) (i32.const 2) func $seven)
      (func (export "f") (param i32) (result i32)
        (table.init $t $a (i32.const 3) (i32.const 0) (local.get 0))
        (i32.const 1)))`,
      0,
    );
    await agree(
      `${TABLE} (elem $a (table $t) (i32.const 2) func $seven)
      (func (export "f") (param i32) (result i32)
        (table.init $t $a (i32.const 3) (i32.const 0) (local.get 0))
        (i32.const 1)))`,
      1,
    );
  });

  it('call_ref, and a null one', async () => {
    const wat = `${TABLE}
      (func (export "f") (param i32) (result i32)
        (call_ref $v (if (result (ref null $v)) (local.get 0)
          (then (ref.func $seven)) (else (ref.null $v))))))`;
    for (const x of [0, 1]) await agree(wat, x);
  });

  it('ref.as_non_null traps on null', async () => {
    for (const x of [0, 1]) {
      await agree(
        `${TABLE} (func (export "f") (param i32) (result i32)
        (ref.is_null (ref.as_non_null (table.get $t (local.get 0))))))`,
        x + 1,
      );
    }
  });

  it('a tail call runs in one frame: a million deep under a depth limit of 100', () => {
    const m = interp(
      `(module (func $down (export "f") (param i32) (result i32)
        (if (result i32) (i32.eqz (local.get 0)) (then (i32.const 42))
          (else (return_call $down (i32.sub (local.get 0) (i32.const 1)))))))`,
      { maxDepth: 100 },
    );
    expect(m.invoke('f', [i32(1_000_000)])).toEqual([i32(42)]);
  });

  it('a table shared between two modules, and a function reference that runs in its own', () => {
    const a = interp(`(module (table (export "t") 2 funcref) (global $g (mut i32) (i32.const 5))
      (func $get (result i32) (global.get $g)) (elem (i32.const 0) func $get))`);
    const b = interp(
      `(module (type $v (func (result i32))) (import "a" "t" (table 2 funcref))
        (global $g (mut i32) (i32.const 99))
        (func (export "f") (result i32) (call_indirect (type $v) (i32.const 0))))`,
      { imports: () => ({ kind: 'table', cell: a.tableCell('t') }) },
    );
    expect(b.invoke('f', [])).toEqual([i32(5)]); // a's $get reads a's global, not b's
  });

  it('an element segment out of bounds traps instantiation, after the ones before it', () => {
    const shared = interp(`(module (table (export "t") 2 funcref))`).tableCell('t');
    expect(() =>
      interp(
        `(module (import "a" "t" (table 2 funcref)) (func $f)
          (elem (i32.const 0) func $f) (elem (i32.const 2) func $f))`,
        { imports: () => ({ kind: 'table', cell: shared }) },
      )
    ).toThrow(Trap);
    expect(shared.elems[0]!.type === 'ref' && shared.elems[0]!.kind).toBe('func');
  });
});

describe('exceptions (E3d)', () => {
  const TAGS = `(tag $a (param i32)) (tag $b (param i32)) (tag $none)
    (func $raise (param i32)
      (if (i32.eq (local.get 0) (i32.const 1)) (then (throw $a (i32.const 10))))
      (if (i32.eq (local.get 0) (i32.const 2)) (then (throw $b (i32.const 20))))
      (if (i32.eq (local.get 0) (i32.const 3)) (then (throw $none)))
      (if (i32.eq (local.get 0) (i32.const 4)) (then (unreachable))))`;

  it('try_table: catch / catch_ref / catch_all / catch_all_ref, the first that matches, across a call', async () => {
    // One function per clause shape; each returns where it landed. x: 0 nothing
    // thrown, 1 $a, 2 $b, 3 $none, 4 a TRAP — which no catch_all catches.
    const clauses = [
      ['(catch $a $h)', '(result i32)', '(i32.add (i32.const 100))'],
      ['(catch_ref $b $h)', '(result i32 exnref)', '(drop) (i32.add (i32.const 200))'],
      ['(catch_all $h)', '', '(i32.const 300)'],
      ['(catch_all_ref $h)', '(result exnref)', '(drop) (i32.const 400)'],
      // Two clauses that both match $a: the FIRST wins (a $b clause before it does not).
      ['(catch $b $h) (catch $a $h) (catch $a $h)', '(result i32)', '(i32.add (i32.const 500))'],
    ];
    for (const [clause, result, landed] of clauses) {
      const wat = `(module ${TAGS}
        (func (export "f") (param i32) (result i32)
          (block $h ${result}
            (try_table ${clause} (call $raise (local.get 0)))
            (return (i32.const 0)))
          ${landed}))`;
      for (const x of [0, 1, 2, 3, 4]) await agree(wat, x);
    }
  });

  it('a tag matches by identity, not signature; an uncaught one leaves the invocation', async () => {
    const wat = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (block $h (result i32)
          (try_table (catch $a $h) (call $raise (local.get 0)))
          (i32.const 0))))`;
    for (const x of [1, 2, 3]) await agree(wat, x); // $b has $a's signature, and escapes
  });

  it('throw_ref rethrows the same exception; a null one traps', async () => {
    const wat = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (block $outer (result i32)
          (try_table (catch $a $outer)
            (throw_ref (block $r (result exnref)
              (try_table (catch_all_ref $r) (call $raise (local.get 0)))
              (ref.null exn))))
          (i32.const 0))))`;
    for (const x of [0, 1, 2]) await agree(wat, x);
  });

  it('legacy try: catch with its payload, catch_all, rethrow to an outer catch', async () => {
    const wat = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do
            (try (result i32)
              (do (call $raise (local.get 0)) (i32.const 0))
              (catch $a (i32.add (i32.const 1)))
              (catch_all (rethrow 0))))
          (catch $b (i32.add (i32.const 1000)))
          (catch_all (i32.const -1)))))`;
    for (const x of [0, 1, 2, 3]) await agree(wat, x);
  });

  it("rethrow under recursion rethrows its OWN frame's exception", async () => {
    // r(n) throws $a(n) and catches it; with n > 0 the catch body returns
    // r(n - 1), else it rethrows. When r(0) rethrows, r(1)'s catch is still
    // active with the same label: rethrow must take the innermost (payload 0),
    // not the outer frame's (payload 1). A mutant that searched outermost-first
    // passed every other test and both spec corpora.
    // Legacy only: V8 refuses a module that mixes legacy and new EH.
    const wat = `(module ${TAGS}
      (func $r (export "f") (param i32) (result i32)
        (try (result i32)
          (do
            (try (result i32)
              (do (throw $a (local.get 0)))
              (catch $a
                (drop)
                (if (result i32) (local.get 0)
                  (then (return (call $r (i32.sub (local.get 0) (i32.const 1)))))
                  (else (rethrow 1))))))
          (catch $a))))`;
    for (const x of [0, 1, 3]) await agree(wat, x);
  });

  it("delegate: to an outer try's handlers, past a block, out of the function", async () => {
    const toTry = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (try $t (result i32)
          (do (try (result i32) (do (call $raise (local.get 0)) (i32.const 0)) (delegate $t)))
          (catch $a (drop) (i32.const 7)))))`;
    for (const x of [0, 1, 2]) await agree(toTry, x);
    const pastBlock = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (try (result i32)
          (do (block $b (result i32)
            (try (result i32) (do (call $raise (local.get 0)) (i32.const 0)) (delegate $b))))
          (catch $a (drop) (i32.const 8)))))`;
    for (const x of [0, 1]) await agree(pastBlock, x);
    const outOfFunction = `(module ${TAGS}
      (func (export "f") (param i32) (result i32)
        (try (result i32) (do (call $raise (local.get 0)) (i32.const 0)) (delegate 0))))`;
    for (const x of [0, 1]) await agree(outOfFunction, x);
  });

  it("an imported tag is the exporter's: its exception is caught across modules", () => {
    const a = interp(`(module (tag (export "e") (param i32))
      (func (export "raise") (param i32) (throw 0 (local.get 0))))`);
    const b = interp(
      `(module (import "a" "e" (tag $e (param i32))) (import "a" "raise" (func $raise (param i32)))
        (func (export "f") (result i32)
          (block $h (result i32) (try_table (catch $e $h) (call $raise (i32.const 5))) (i32.const 0))))`,
      {
        imports: (_m: string, f: string) =>
          f === 'e'
            ? { kind: 'tag' as const, cell: a.tagCell('e') }
            : { kind: 'func' as const, call: (args: Value[]) => a.invoke('raise', args) },
      },
    );
    expect(b.invoke('f', [])).toEqual([i32(5)]);
  });
});

describe('GC (E3d-2)', () => {
  const TYPES = `
    (type $pt (sub (struct (field $x (mut i32)) (field $y (mut i8)))))
    (type $pt3 (sub $pt (struct (field $x (mut i32)) (field $y (mut i8)) (field $z i64))))
    (type $other (struct (field i32) (field i8)))
    (type $bytes (array (mut i8)))
    (type $refs (array (mut (ref null $pt))))
    (type $fns (array (mut funcref)))
    (data $d "\\01\\ff\\80\\7f")`;
  const F = (body: string, params = '(param i32)') =>
    `(module ${TYPES} (elem $e func $id) (func $id) (func (export "f") ${params} (result i32) ${body}))`;

  it('struct.new / get / set, a packed field read signed and unsigned, defaults', async () => {
    for (const x of [0, 1, 127, 128, 255, 256, -1]) {
      for (const get of ['struct.get_s', 'struct.get_u']) {
        await agree(F(`(${get} $pt $y (struct.new $pt (i32.const 1) (local.get 0)))`), x);
      }
      await agree(
        F(`(local $p (ref $pt)) (local.set $p (struct.new_default $pt))
        (struct.set $pt $y (local.get $p) (local.get 0))
        (i32.add (struct.get $pt $x (local.get $p)) (struct.get_s $pt $y (local.get $p)))`),
        x,
      );
    }
  });

  it('a null struct, array and i31 trap with their own messages', async () => {
    await agree(F('(struct.get $pt $x (ref.null $pt))', ''));
    await agree(F('(array.len (ref.null $bytes))', ''));
    await agree(F('(i31.get_s (ref.null i31))', ''));
  });

  it('arrays: new / default / fixed / data / elem, get, set, len, bounds', async () => {
    for (const i of [0, 3, 4, -1]) {
      await agree(
        F('(array.get_s $bytes (array.new_data $bytes $d (i32.const 0) (i32.const 4)) (local.get 0))'),
        i,
      );
      await agree(
        F('(array.get_u $bytes (array.new $bytes (i32.const 300) (i32.const 4)) (local.get 0))'),
        i,
      );
      await agree(
        F('(array.get_u $bytes (array.new_fixed $bytes 2 (i32.const 7) (i32.const 8)) (local.get 0))'),
        i,
      );
    }
    for (const n of [0, 4, 5]) {
      await agree(F('(array.len (array.new_data $bytes $d (i32.const 0) (local.get 0)))'), n);
    }
    for (const n of [0, 1, 2]) {
      await agree(F('(array.len (array.new_elem $fns $e (i32.const 0) (local.get 0)))'), n);
    }
  });

  it('array.fill / copy (overlapping both ways) / init_data / init_elem, and their bounds', async () => {
    const A = '(array.new_data $bytes $d (i32.const 0) (i32.const 4))';
    for (const [d, s] of [[1, 0], [0, 1]]) {
      for (const read of [0, 1, 2, 3]) {
        await agree(F(
          `(local $a (ref $bytes)) (local.set $a ${A})
          (array.copy $bytes $bytes (local.get $a) (i32.const ${d}) (local.get $a) (i32.const ${s}) (i32.const 3))
          (array.get_u $bytes (local.get $a) (i32.const ${read}))`,
          '',
        ));
      }
    }
    for (const n of [0, 2, 3]) {
      await agree(
        F(`(local $a (ref $bytes)) (local.set $a ${A})
        (array.fill $bytes (local.get $a) (i32.const 2) (i32.const 9) (local.get 0))
        (array.get_u $bytes (local.get $a) (i32.const 3))`),
        n,
      );
      await agree(
        F(`(local $a (ref $bytes)) (local.set $a ${A})
        (array.init_data $bytes $d (local.get $a) (i32.const 1) (i32.const 1) (local.get 0))
        (array.get_u $bytes (local.get $a) (i32.const 1))`),
        n,
      );
    }
  });

  it('i31: the low 31 bits, read back signed and unsigned; ref.eq by value', async () => {
    for (const x of [0, 1, 0x3fffffff, 0x40000000, -1, 0x7fffffff]) {
      await agree(F('(i31.get_s (ref.i31 (local.get 0)))'), x);
      await agree(F('(i31.get_u (ref.i31 (local.get 0)))'), x);
      await agree(
        F('(ref.eq (ref.i31 (local.get 0)) (ref.i31 (i32.and (local.get 0) (i32.const 0x7fffffff))))'),
        x,
      );
    }
  });

  it('ref.eq: the same struct, not an equal one', async () => {
    await agree(F(
      `(local $p (ref $pt)) (local.set $p (struct.new_default $pt))
      (i32.add (i32.mul (ref.eq (local.get $p) (local.get $p)) (i32.const 10))
               (ref.eq (local.get $p) (struct.new_default $pt)))`,
      '',
    ));
  });

  it('casts along a subtype chain, and a structurally equal type that is not a supertype', async () => {
    const make = [
      '(struct.new_default $pt)',
      '(struct.new $pt3 (i32.const 1) (i32.const 2) (i64.const 3))',
    ];
    for (const v of make) {
      for (const t of ['$pt', '$pt3', '$other', 'struct', 'eq', 'any', 'array', 'i31']) {
        await agree(F(`(ref.test (ref ${t}) ${v})`, ''));
        await agree(F(`(ref.is_null (ref.cast (ref null ${t}) ${v}))`, ''));
      }
    }
    for (const t of ['$pt', 'none']) {
      await agree(F(`(ref.test (ref null ${t}) (ref.null none))`, ''));
    }
  });

  it('br_on_cast / br_on_cast_fail / br_on_null / br_on_non_null', async () => {
    for (
      const v of [
        '(struct.new_default $pt)',
        '(struct.new $pt3 (i32.const 1) (i32.const 2) (i64.const 3))',
        '(ref.null $pt)',
      ]
    ) {
      await agree(F(
        `(block $hit (result (ref $pt3))
          (drop (br_on_cast $hit (ref null $pt) (ref $pt3) ${v}))
          (return (i32.const 0)))
        (drop) (i32.const 1)`,
        '',
      ));
      await agree(F(
        `(block $miss (result (ref null $pt))
          (drop (br_on_cast_fail $miss (ref null $pt) (ref $pt3) ${v}))
          (return (i32.const 0)))
        (drop) (i32.const 1)`,
        '',
      ));
      await agree(
        F(`(block $null (drop (br_on_null $null ${v})) (return (i32.const 0))) (i32.const 1)`, ''),
      );
      await agree(F(
        `(block $nn (result (ref $pt)) (br_on_non_null $nn ${v}) (return (i32.const 0)))
        (drop) (i32.const 1)`,
        '',
      ));
    }
  });

  it('call_indirect matches by type identity: a different rec group is a different type', async () => {
    const wat = `(module
      (rec (type $f1 (func (result i32))) (type (struct)))
      (type $f2 (func (result i32)))
      (type $sub (sub (func (result i32))))
      (type $subsub (sub $sub (func (result i32))))
      (table 3 funcref) (elem (i32.const 0) func $a $b $c)
      (func $a (type $f1) (i32.const 1))
      (func $b (type $f2) (i32.const 2))
      (func $c (type $subsub) (i32.const 3))
      (func (export "f") (param i32) (result i32) (call_indirect (type $f2) (local.get 0))))`;
    for (const i of [0, 1, 2]) await agree(wat, i);
    const viaSuper = wat.replace('(call_indirect (type $f2)', '(call_indirect (type $sub)');
    for (const i of [0, 1, 2]) await agree(viaSuper, i);
  });

  it('(exact $t) admits $t and none of its subtypes (custom descriptors)', () => {
    // V8 runs exact types only behind an experimental flag, so the expectation is
    // the proposal's rule itself: exact excludes declared subtypes. (A mutant that
    // ignored `exact` passed every other test and the whole core suite.)
    const m = interp(`(module ${TYPES}
      (func (export "f") (param i32) (result i32)
        (ref.test (ref (exact $pt))
          (if (result (ref $pt)) (local.get 0)
            (then (struct.new $pt3 (i32.const 1) (i32.const 2) (i64.const 3)))
            (else (struct.new_default $pt))))))`);
    expect(m.invoke('f', [i32(0)])).toEqual([i32(1)]); // a $pt
    expect(m.invoke('f', [i32(1)])).toEqual([i32(0)]); // a $pt3, a subtype of $pt
  });

  it("a reference to an IMPORTED function is the function itself, with the exporter's type", async () => {
    // B imports A's $sub-typed function declared as its supertype $super; a
    // cast to $sub must still succeed (the reference is A's function). The
    // interpreter minted one typed by B's declaration until the custom-
    // descriptors corpus showed it; V8 is the oracle here.
    const A =
      `(module (type $super (sub (func (result i32)))) (type $sub (sub $super (func (result i32))))
      (func (export "f") (type $sub) (i32.const 9)))`;
    const B =
      `(module (type $super (sub (func (result i32)))) (type $sub (sub $super (func (result i32))))
      (import "a" "f" (func $f (type $super))) (elem declare func $f)
      (func (export "t") (result i32) (ref.test (ref $sub) (ref.func $f)))
      (func (export "c") (result i32) (call_ref $sub (ref.cast (ref $sub) (ref.func $f)))))`;
    const engineA = await WebAssembly.instantiate(
      wat2wasm(A, { textForm: false }).binary as BufferSource,
    );
    const engineB = await WebAssembly.instantiate(
      wat2wasm(B, { textForm: false }).binary as BufferSource,
      {
        a: { f: engineA.instance.exports.f },
      },
    );
    const a = interp(A);
    const b = interp(B, {
      imports: () => ({
        kind: 'func' as const,
        call: (args: Value[]) => a.invoke('f', args),
        func: a.funcRefOf('f'),
      }),
    });
    for (const name of ['t', 'c']) {
      const want = (engineB.instance.exports[name] as () => number)();
      expect(b.invoke(name, [])).toEqual([i32(want)]);
    }
  });

  it('two modules with the same rec group share its types: a cast across them succeeds', () => {
    const GROUP = '(rec (type $s (struct (field i32))) (type (func)))';
    const a = interp(
      `(module ${GROUP} (global (export "g") (ref $s) (struct.new $s (i32.const 7))))`,
    );
    const b = interp(
      `(module ${GROUP} (import "a" "g" (global $g (ref $s)))
        (func (export "f") (result i32) (struct.get $s 0 (ref.cast (ref $s) (global.get $g)))))`,
      { imports: () => ({ kind: 'global', cell: a.globalCell('g') }) },
    );
    expect(b.invoke('f', [])).toEqual([i32(7)]);
  });

  it('extern.convert_any then any.convert_extern gives back the very value', async () => {
    await agree(F(
      `(local $p (ref $pt)) (local.set $p (struct.new_default $pt))
      (ref.eq (local.get $p) (ref.cast (ref $pt) (any.convert_extern (extern.convert_any (local.get $p)))))`,
      '',
    ));
  });
});
