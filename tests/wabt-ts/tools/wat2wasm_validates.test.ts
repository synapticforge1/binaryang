// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// `wat2wasm` validates by default, as upstream wabt's does (owner, 2026-09-29:
// "we want to do the same"): `--no-check` skips it, `--enable-*` /
// `--disable-*` / `--enable-all` choose the proposals, starting from upstream's
// default set. The LIBRARY function keeps validation opt-in (`validate`), as
// upstream's JS library separates parsing from validating.
//
// Making it validate found that the validator could not take a label by NAME
// at all — `(block $l (br $l))` threw "var is not resolved" — because the text
// parser keeps label references as names and only the binary writer turned
// them into depths. The validator now resolves them itself; the depth cases
// below each pair a VALID reference with an INVALID one, so a wrong depth
// shows as a wrong verdict, not only as a throw.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { main } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import process from 'node:process';

const verdict = (wat: string): string => {
  const r = wat2wasm(wat, { filename: 't.wat', validate: true });
  return r.errors.length === 0 ? 'valid' : r.errors[0]!.message;
};

describe('labels by name reach the right depth', () => {
  // `$outer` carries an i64, `$inner` an i32: branching to the wrong one with
  // the wrong value is a type error, so a mis-resolved depth changes the verdict.
  const nest = (body: string) =>
    `(module (func (result i64)
      (block $outer (result i64)
        (drop (block $inner (result i32) ${body} (i32.const 0)))
        (i64.const 0))))`;
  const cases: [string, string, string][] = [
    ['br', '(br $outer (i64.const 1))', '(br $inner (i64.const 1))'],
    [
      'br_if',
      '(br_if $outer (i64.const 1) (i32.const 1)) (drop)',
      '(br_if $inner (i64.const 1) (i32.const 1)) (drop)',
    ],
    [
      'br_table',
      '(br_table $outer $outer (i64.const 1) (i32.const 0))',
      '(br_table $outer $inner (i64.const 1) (i32.const 0))',
    ],
  ];
  for (const [name, good, bad] of cases) {
    it(name, () => {
      expect(verdict(nest(good))).toBe('valid');
      expect(verdict(nest(bad))).toMatch(/type mismatch/);
    });
  }

  it('a loop label is its start: branching to it carries its (no) params, not the block result', () => {
    // `$b` wants an i32, `$l` nothing: resolved the wrong way round, each verdict flips.
    const wat = (target: string) =>
      `(module (func (result i32) (block $b (result i32) (loop $l (br ${target})) (i32.const 0))))`;
    expect(verdict(wat('$l'))).toBe('valid');
    expect(verdict(wat('$b'))).toMatch(/type mismatch/);
  });

  it('br_on_null to an outer label', () => {
    const wat = (target: string) =>
      `(module (func (param funcref) (result i64)
        (block $outer (result i64)
          (drop (block $inner (result i32)
            (i64.const 7) (local.get 0) (br_on_null ${target}) (drop) (drop) (i32.const 0)))
          (i64.const 0))))`;
    expect(verdict(wat('$outer'))).toBe('valid');
    expect(verdict(wat('$inner'))).toMatch(/type mismatch/);
  });

  it('try_table catches resolve in the ENCLOSING scope, not the try_table own label', () => {
    // `$h` takes nothing; one level deeper is the FUNCTION, which takes an
    // i64 — a `catch_all` delivers nothing, so the wrong depth is invalid.
    expect(verdict(`(module (func (result i64)
      (block $h (try_table (catch_all $h))) (i64.const 0)))`)).toBe('valid');
    // And a label of the wrong type is still refused at the right depth.
    expect(verdict(`(module (func (result i32)
      (block $h (result i32) (try_table (result i32) (catch_all $h) (i32.const 1)))))`))
      .toMatch(/type mismatch|expected/);
  });

  it('a delegate by name validates', () => {
    // Its depth is resolved OUTSIDE its own try, as the spec reads it and the
    // binary writer encodes it. The verdict cannot show an off-by-one there:
    // a delegate's depth is checked for range only, and one level deeper is
    // the function frame — always a legal target.
    expect(verdict(`(module (func (block $out (try $t (do) (delegate $out)))))`)).toBe('valid');
    expect(verdict(`(module (func (try $t (do) (delegate $t))))`)).not.toBe('valid');
  });

  it('shadowing: the innermost of two labels with one name', () => {
    const wat = (inner: string) =>
      `(module (func (result i64) (block $l (result i64)
        (drop (block $l (result ${inner}) (br $l (i64.const 1)))) (i64.const 0))))`;
    expect(verdict(wat('i64'))).toBe('valid');
    expect(verdict(wat('i32'))).toMatch(/type mismatch/);
  });
});

describe('the CLI validates by default', () => {
  async function cli(args: string[]): Promise<{ code: number | undefined; stderr: string }> {
    const dir = await Deno.makeTempDir();
    const errs: string[] = [];
    // The tool reports through console.error and ends with process.exit: both
    // are captured for the call, and both restored after it.
    const origError = console.error;
    const origExit = process.exit;
    let code: number | undefined;
    console.error = (...a: unknown[]) => errs.push(a.join(' '));
    process.exit = ((c: number) => {
      code = c;
      throw new Error('exit');
    }) as typeof process.exit;
    try {
      await Deno.writeTextFile(`${dir}/in.wat`, INVALID);
      await Deno.writeTextFile(`${dir}/gc.wat`, GC);
      await Deno.writeTextFile(`${dir}/ok.wat`, '(module (func))');
      await main(args.map((a) => a.replace('DIR', dir))).catch(() => {});
    } finally {
      console.error = origError;
      process.exit = origExit;
      await Deno.remove(dir, { recursive: true });
    }
    return { code, stderr: errs.join('\n') };
  }
  const INVALID = '(module (func (result i32) (i64.const 1)))';
  const GC = '(module (type $t (struct)) (func (drop (struct.new $t))))';

  it('an invalid module: an error at its position, exit 1', async () => {
    const r = await cli(['DIR/in.wat', '-o', 'DIR/out.wasm']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/in\.wat:1:\d+: error: type mismatch/);
  });

  it('--no-check writes it anyway', async () => {
    const r = await cli(['DIR/in.wat', '--no-check', '-o', 'DIR/out.wasm']);
    expect(r.code).toBeUndefined();
  });

  it("upstream's default features: GC needs --enable-gc", async () => {
    expect((await cli(['DIR/gc.wat', '-o', 'DIR/out.wasm'])).stderr).toMatch(/gc/i);
    expect((await cli(['DIR/gc.wat', '--enable-gc', '-o', 'DIR/out.wasm'])).code).toBeUndefined();
  });

  it('an unknown option is refused, not ignored', async () => {
    // A VALID module, so the exit can come only from the option.
    const r = await cli(['DIR/ok.wat', '--enable-gcc', '-o', 'DIR/out.wasm']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown option --enable-gcc');
  });
});
