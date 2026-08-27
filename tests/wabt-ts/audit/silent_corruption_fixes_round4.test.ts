// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Round-4 regression tests for the 2026-06-09 silent-corruption audit — the
 * fourth-sweep findings (validator tail-call / try_table soundness + lexer
 * fail-loud gaps). See cmem/design-decisions.md.
 */

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

import { parseWatModule } from '../../src/parser/wast-parser.ts';
import { allFeatures } from '../../src/core/feature.ts';
import { resolveNames } from '../../src/ir/resolve-names.ts';
import { synthesizeTypes } from '../../src/ir/synthesize-types.ts';
import { validateModule } from '../../src/validator/validator.ts';
import { hasErrors, makeErrorList } from '../../src/core/error.ts';

/** parse → resolve → synthesize → validate; true if validation found errors. */
function validateWat(wat: string): boolean {
  const { module, errors } = parseWatModule(wat);
  if (errors.length > 0) throw new Error(`parse failed: ${errors[0]?.message}`);
  resolveNames(module);
  synthesizeTypes(module);
  const errs = makeErrorList();
  validateModule(module, errs, { features: allFeatures() });
  return hasErrors(errs);
}

/** true if parsing (lexing) the source produced at least one error. */
function parseErrors(wat: string): boolean {
  return parseWatModule(wat).errors.length > 0;
}

// ---------------------------------------------------------------------------
// return_call result-type soundness (callee results vs ENCLOSING func results)
// ---------------------------------------------------------------------------

describe('return_call result soundness', () => {
  it('rejects a tail call whose result type differs from the caller', () => {
    assert(
      validateWat(`(module
        (func $f (result i32) i32.const 0)
        (func (result f64) return_call $f))`),
      'return_call to an i32-result fn from an f64-result fn must fail',
    );
  });
  it('accepts a tail call whose result type matches the caller', () => {
    assert(
      !validateWat(`(module
        (func $f (result i32) i32.const 0)
        (func (result i32) return_call $f))`),
      'matching return_call should validate',
    );
  });
});

// ---------------------------------------------------------------------------
// Lexer fail-loud gaps
// ---------------------------------------------------------------------------

describe('lexer fail-loud', () => {
  it('reports an unterminated string literal', () => {
    assert(parseErrors('(module (memory 1) (data (i32.const 0) "abc'));
  });
  it('reports a bare $ (empty identifier)', () => {
    assert(parseErrors('(module (func $ ))'));
  });
  it('reports a \\u{} escape with no hex digits', () => {
    assert(parseErrors('(module (memory 1) (data (i32.const 0) "\\u{}"))'));
  });
  it('still accepts a valid \\u{41} escape', () => {
    assert(!parseErrors('(module (memory 1) (data (i32.const 0) "\\u{41}"))'));
  });
});
