// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.50 / A1 — the bridge's de-coarsening is incomplete.
//
// T13.47 replaced the coarsening `wabtTypeToValType` with the precise
// `wabtTypeToValueType` only at the sites the tests happened to exercise. The
// rest still coarsen, and coarsening a typed reference `(ref $T)` to the
// abstract `structref` destroys exactly the information binaryen-ts's encoder
// needs: `gcFuncTypeIndex` looks for a declared func heap type whose params and
// results match EXACTLY, so a coarsened signature matches nothing and throws
// `unresolved GC function type`.
//
// Three shapes were MEASURED as failing before the merge and remained failing
// after it. No test covered any of them, which is why the bridge suite read
// green — the gap was in the harness, not in the bar.
//
// The third shape is a DIFFERENT defect that happens to sit next door: the
// bridge refuses `ref.null` with a user-defined heap type. It is kept in this
// file because it is found the same way, but it is deliberately its own test —
// widening the de-coarsening must not be assumed to have fixed it.
//
// FIXED 2026-08-27, and the third shape turned out to be TWO defects stacked,
// which is the reason it needed its own test rather than an assumption:
//
//   1. `refTypeVarToValType` threw "not yet supported" for an index-form heap
//      type, on the stated grounds that it "needs the typed-ref IR refactor".
//      That refactor is what T13.47 landed — `makeRefNull` already took a
//      `ValueType`, and `resolveHeapTypeIdx` already mapped the index. The
//      limitation had outlived its cause.
//   2. Removing it moved the error rather than clearing it: the global's own
//      type still went through the COARSENING converter in `addGlobal`, so a
//      global declared `(ref null $T)` was emitted as `structref` and
//      mismatched every use that kept the precise type.
//
// Watching the error message move — `not yet supported` becoming
// `type mismatch in function` — is what showed the second defect was there. A
// failure count alone would have read as "still broken".

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { Result } from '../../../src/wabt-ts/core/result.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

import { bridgeToBinaryen } from '../../../src/wabt-ts/bridge/bridge.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

/** Parse → resolve → bridge → encode → decode → validate. Throws with the stage that failed. */
function bridgeAndValidate(wat: string): void {
  const ls = new LexerSource(wat, '<gc-decoarsening>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);

  const wasm = encodeWasm(bridgeToBinaryen(module));
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  // GC and typed references are feature-gated in the validator (T13.10), so a
  // module using them fails validation on the default feature set. That is the
  // validator doing its job, not a bridge defect.
  const r = validateModule(decoded, errs, { features: allFeatures() });
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);
  assertEquals(r, Result.Ok);
}

describe('T13.50 — typed references survive the bridge', () => {
  // Shape 1: an IMPORTED function whose parameter is `(ref $T)`.
  // addFunctionImport mapped its signature through the coarsening converter.
  it('an imported func with a (ref $T) param', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (import "m" "f" (func $imp (param (ref $T))))
        (func (export "g") (param (ref $T))
          (call $imp (local.get 0))))
    `);
  });

  // Shape 2: a TAG whose parameter is `(ref $T)`. addTag had the same problem.
  it('a tag with a (ref $T) param', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (tag $e (param (ref $T)))
        (func (export "g") (param (ref $T))
          (throw $e (local.get 0))))
    `);
  });

  // A declared function (not imported) — the case T13.47 already fixed. Present
  // so a regression that re-coarsens everything is distinguishable from one that
  // only misses the import path.
  it('a declared func with a (ref $T) param still works', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (func (export "g") (param (ref $T)) (result i32)
          (struct.get $T 0 (local.get 0))))
    `);
  });
});

describe('T13.50b — ref.null with a user-defined heap type', () => {
  // A DIFFERENT defect from the de-coarsening, sitting next door. Do not assume
  // widening the converter fixed this; it needs its own change and its own proof.
  it('a global of type (ref null $T)', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (global $g (ref null $T) (ref.null $T))
        (func (export "g") (result (ref null $T))
          (global.get $g)))
    `);
  });
});
