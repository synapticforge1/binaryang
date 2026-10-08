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
    engine = `trap: ${(e as Error).message}`;
  }
  let ours: number | string;
  try {
    const [r] = interp(wat).invoke('f', args.map(i32));
    ours = r!.type === ValType.I32 ? r!.value : NaN;
  } catch (e) {
    if (!(e instanceof Trap)) throw e;
    ours = `trap: ${e.message}`;
  }
  expect(typeof ours === 'string').toBe(typeof engine === 'string');
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
    const wat = `(module (table 1 funcref) (func (export "f") (result i32) (table.size 0)))`;
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
