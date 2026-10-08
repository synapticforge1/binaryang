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
    const wat = `(module (memory 1) (func (export "f") (result i32) (i32.load (i32.const 0))))`;
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
