// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// Open-work 16, 2026-09-29: can a user ACT on the diagnostic the CLI prints?
//
// Every case below printed something a user could not act on, while the
// wording and offset measurements (T13.37/38, A3) were green — they read the
// `loc` and `message` fields, and a user reads the RENDERED line. Measured over
// the spec's 4,654 must-reject cases by `deno task diagnostics`; before → after:
//
//   binary diagnostics located   0% → 99%   (every one printed `file:0:0`)
//   placeholder subjects          420 → 0     (`type mismatch in opcode`)
//   malformed binaries with >1 error  75 → 0  (up to 9, the real one first)
//   wasm-opt on an invalid input  blamed the OPTIMIZER, in V8's words

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import {
  ErrorFormat,
  ErrorLevel,
  formatErrors,
  formatLocation,
  makeErrorList,
} from '../../../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { wat2wasm } from '../../../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../../../src/wabt-ts/tools/wasm-validate.ts';
import { wasmOpt } from '../../../src/binaryen-ts/tools/wasm-opt.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

/** Assemble without validating (`wat2wasm` does not validate), so the bytes can be invalid. */
function bytes(wat: string): Uint8Array {
  const r = wat2wasm(wat);
  expect(r.errors).toEqual([]);
  return r.binary;
}

const I32_ADD_OF_I64 = '(module (func (param i32) (result i32) ' +
  '(local.get 0) (i64.const 1) (i32.add)))';

/** The spec's `binary.wast:126`: a local count whose LEB is too large, then a body. */
const LOCAL_COUNT_TOO_LARGE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00,
  0x03,
  0x02,
  0x01,
  0x00,
  0x0a,
  0x0c,
  0x01,
  0x0a,
  0x02,
  0x80,
  0x80,
  0x80,
  0x80,
  0x10,
  0x7f,
  0x02,
  0x7e,
  0x0b,
]);

describe('a binary diagnostic shows its OFFSET', () => {
  it('as upstream prints it: file:0000024', () => {
    const { errors } = wasmValidate(bytes(I32_ADD_OF_I64), { filename: 'm.wasm' });
    const line = formatErrors(errors).split('\n')[0]!;
    // It printed `m.wasm:0:0:` — text coordinates, because a filename was set.
    expect(line).toMatch(/^m\.wasm:[0-9a-f]{7}: error: /);
    expect(line).not.toContain(':0:0:');
  });

  it('text keeps line:col; a location holding neither prints the name alone', () => {
    const loc = { filename: 'm.wat', line: 3, column: 5, offset: 0 };
    expect(formatLocation(loc)).toBe('m.wat:3:5');
    expect(formatLocation({ ...loc, line: 0, column: 0, offset: 0x24 })).toBe('m.wat:0000024');
    expect(formatLocation({ ...loc, line: 0, column: 0 })).toBe('m.wat');
    expect(formatLocation({ filename: '', line: 0, column: 0, offset: 0x24 })).toBe(
      '<binary>:0x00000024',
    );
  });
});

describe('a type mismatch NAMES the instruction', () => {
  const cases: [string, string, string][] = [
    ['binary (checkOpcode2)', I32_ADD_OF_I64, 'in i32.add'],
    [
      'unary (checkOpcode1)',
      '(module (func (result i32) (i64.const 1) (i32.eqz)))',
      'in i32.eqz',
    ],
    [
      'ternary',
      '(module (func (drop (v128.bitselect (i32.const 0) (i32.const 0) (i32.const 0)))))',
      'in v128.bitselect',
    ],
    [
      'load_splat',
      '(module (memory 1) (func (drop (v128.load8_splat (f32.const 0)))))',
      'in v128.load8_splat',
    ],
  ];
  for (const [name, wat, want] of cases) {
    it(name, () => {
      const { errors } = wasmValidate(bytes(wat), { features: allFeatures() });
      expect(errors[0]?.message).toContain(want);
      expect(errors[0]?.message).not.toMatch(/\bin (opcode|ternary|load_splat)\b/);
    });
  }
});

describe('a malformed binary reports ONE error — the real one', () => {
  it('the reader stops at the first error (binary.wast:126 reported 9)', () => {
    const errors = makeErrorList();
    readBinaryIr(LOCAL_COUNT_TOO_LARGE, errors);
    expect(errors.map((e) => e.message)).toEqual(['integer too large']);
  });

  it('stopOnFirstError: false still collects the rest', () => {
    const errors = makeErrorList();
    readBinaryIr(LOCAL_COUNT_TOO_LARGE, errors, { stopOnFirstError: false });
    expect(errors.length).toBeGreaterThan(1);
    expect(errors[0]?.message).toBe('integer too large');
  });

  it('wasm-validate does not validate a module it could not decode', () => {
    // Cut inside the code section: the function is declared, its body is not read.
    const { errors } = wasmValidate(bytes(I32_ADD_OF_I64).slice(0, 30));
    // It went on to "type mismatch in function, expected 1 elements on the stack but got 0".
    expect(errors.filter((e) => e.level === ErrorLevel.Error).length).toBe(1);
    expect(errors[0]?.message).not.toContain('type mismatch');
  });
});

describe('wasm-opt blames an invalid INPUT on the input', () => {
  async function optimize(name: string, content: Uint8Array | string, validate = true) {
    const dir = await Deno.makeTempDir();
    try {
      const path = `${dir}/${name}`;
      if (typeof content === 'string') await Deno.writeTextFile(path, content);
      else await Deno.writeFile(path, content);
      return await wasmOpt(path, { optimizeLevel: 2, validate });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }

  it('a binary: the instruction, at an offset into the user file', async () => {
    // It said "optimized module failed validation: WebAssembly.compile(): …".
    const e = await optimize('in.wasm', bytes(I32_ADD_OF_I64)).catch((e: Error) => e);
    expect(e).toBeInstanceOf(Error);
    const msg = (e as Error).message;
    expect(msg).toMatch(/^input module is not valid:\n.*in\.wasm:[0-9a-f]{7}: error: /);
    expect(msg).toContain('in i32.add');
    expect(msg).not.toContain('optimized module');
  });

  it('WAT: the instruction, at its line and column in the text, with the source line', async () => {
    // Validated as TEXT since 2026-09-29 (wat2wasm validates, as upstream); it
    // was the filename alone, the bytes' offsets being ones the user never had.
    const e = await optimize('in.wat', I32_ADD_OF_I64).catch((e: Error) => e);
    const msg = (e as Error).message;
    expect(msg).toMatch(/in\.wat:1:\d+: error: type mismatch in i32\.add/);
    expect(msg).toContain('(i32.add)))\n');
    expect(msg).not.toMatch(/in\.wat:[0-9a-f]{7}/);
  });

  it('WAT that does not parse is reported at its file, line and column', async () => {
    const e = await optimize('in.wat', '(module\n  (func (i32.cosnt 1)))').catch((e: Error) => e);
    // It said `<input>:2:9`.
    expect((e as Error).message).toMatch(/in\.wat:2:\d+: error: unknown operator/);
  });

  it('validate: false skips the input check, as upstream --no-validation', async () => {
    const out = await optimize('in.wasm', bytes(I32_ADD_OF_I64), false);
    expect(out).toBeInstanceOf(Uint8Array);
  });
});

describe('a text diagnostic shows the source line and a caret', () => {
  it('under the column, tabs kept as tabs', () => {
    const source = '(module\n\t(func\n\t\t(i32.bogus)))';
    const { errors } = wat2wasm(source, { filename: 't.wat' });
    const out = formatErrors(errors, ErrorFormat.Long, source).split('\n');
    expect(out[0]).toMatch(/^t\.wat:3:3: error: /);
    expect(out[1]).toBe('\t\t(i32.bogus)))');
    expect(out[2]).toBe('\t\t^');
  });

  it('the short format is unchanged', () => {
    const { errors } = wat2wasm('(module (func (i32.bogus)))', { filename: 't.wat' });
    expect(formatErrors(errors).split('\n').length).toBe(1);
  });
});
