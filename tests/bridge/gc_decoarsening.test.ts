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

import { LexerSource } from '../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../src/wabt-ts/core/error.ts';
import { Result } from '../../src/wabt-ts/core/result.ts';
import { allFeatures } from '../../src/wabt-ts/core/feature.ts';

import { bridgeToBinaryen } from '../../src/bridge/bridge.ts';
import { encodeWasm } from '../../src/binaryen-ts/encoder/index.ts';

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
  //
  // ⚠️ The tag's signature is deliberately UNIQUE — `(ref $T) i32`, which no
  // function here shares. The first version of this test gave the tag the same
  // signature as the exported function, and it passed against a HALF fix: the
  // converter was precise, but tag signatures were never registered as func heap
  // types, so `gcFuncTypeIndex` resolved only by coincidence. With a unique
  // signature it threw `unresolved GC function type` — green for the wrong
  // reason, exactly the trap wasmtk documented about their own fixture.
  // The SAME defect with nothing GC-typed about the tag at all.
  //
  // Probed 2026-08-27 by reverting the tag registration: this shape fails with
  // `unresolved GC function type: (i64, f32) -> ()`. So the `(ref $T)` param in
  // the test below is INCIDENTAL -- it is how the shape was found, not what it
  // requires. The real precondition is a conjunction:
  //
  //   1. the module contains a struct or array type, which flips the encoder
  //      onto the GC path where every signature resolves by exact match, AND
  //   2. no function or import shares the tag's exact signature.
  //
  // Neither conjunct mentions the tag's own types. A module with a tag whose
  // params are `i64 f32` is affected as long as some unrelated struct exists.
  // That makes the defect WIDER than it was described, which matters because a
  // consumer checking their fixtures for `(ref $T)` tag params would conclude
  // they were unaffected and be wrong.
  it('a tag with a PLAIN signature no function shares, in a GC module', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (tag $e (param i64 f32))
        (func (export "g") (param (ref $T))
          (throw $e (i64.const 1) (f32.const 2))))
    `);
  });

  it('a tag with a (ref $T) param and a signature no function shares', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (tag $e (param (ref $T) i32))
        (func (export "g") (param (ref $T))
          (throw $e (local.get 0) (i32.const 1))))
    `);
  });

  // Shape 4: an IMPORTED global. Declared globals were switched to the precise
  // converter; imported ones were not, and `addGlobalImport` takes a ValueType.
  it('an imported global of type (ref null $T)', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (import "m" "g" (global $ig (ref null $T)))
        (func (export "f") (result (ref null $T)) (global.get $ig)))
    `);
  });

  // Shape 5: a function LOCAL. `Local.type` is a ValueType and the params and
  // results beside it were already precise, so a coarsened local made any
  // struct.get through it a type mismatch — this affects essentially any GC
  // module that puts a typed reference in a local.
  it('a local of type (ref null $T)', () => {
    bridgeAndValidate(`
      (module
        (type $T (struct (field i32)))
        (func (export "f") (param (ref $T)) (result i32)
          (local $l (ref null $T))
          (local.set $l (local.get 0))
          (struct.get $T 0 (local.get $l))))
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
