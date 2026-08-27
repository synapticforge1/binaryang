// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The four `br_on_*` GC branch instructions, end to end and EXECUTED.
//
// These were reported to us as a single missing bridge case, and the estimate
// we gave back — "one bridge case, BrOnOp is already complete" — was wrong.
// Adding the bridge cases made two of the four work; the other two exposed
// two further defects, each in a different file, neither in the bridge's
// instruction switch:
//
//   1. `bridgeBlockType` refused EVERY `func_type` blocktype as "multi-value
//      not yet supported". A block whose result is `(ref $T)` has no other
//      spelling — wabt's `value` blocktype holds a numeric `Type` with no room
//      for a concrete heap type — so every br_on_cast-shaped block was
//      unbridgeable for a reason unrelated to multi-value.
//   2. `writeBlockType` wrote a typed-ref block result INLINE. Both spellings
//      are legal (blocktype is s33, and `(ref ht)` starts 0x64, which
//      sign-extends negative and so reads as a valtype) but the inline one did
//      not round-trip: wabt's own output for the same module used the type
//      index, and only that form validated.
//   3. The bridge declared func heap types for functions, imports and tags but
//      not for the type-section entries a blocktype references, so the encoder
//      threw `unresolved GC function type: () -> (ref 0)`.
//
// Each test therefore RUNS the module and checks a value, not just validity.
// Defect 2 produced a module that validated at the wabt layer and was rejected
// only after a re-encode, so "it validates" would have passed against it.

import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';

import { LexerSource } from '../../../src/wabt-ts/parser/lexer-source.ts';
import { parseWatModule } from '../../../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../../../src/wabt-ts/ir/resolve-names.ts';
import { readBinaryIr } from '../../../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../../../src/wabt-ts/validator/validator.ts';
import { formatErrors, hasErrors, makeErrorList } from '../../../src/wabt-ts/core/error.ts';
import { allFeatures } from '../../../src/wabt-ts/core/feature.ts';

import { bridgeToBinaryen } from '../../../src/wabt-ts/bridge/bridge.ts';
import { encodeWasm } from '../../../src/binaryen-ts/encoder/index.ts';

/** Parse → resolve → bridge → encode → decode → validate → INSTANTIATE → call `f`. */
function bridgeAndRun(wat: string): number {
  const ls = new LexerSource(wat, '<br-on>');
  const { module, errors } = parseWatModule(ls);
  if (hasErrors(errors)) throw new Error(`Parse:\n${formatErrors(errors)}`);
  const rerrs = makeErrorList();
  resolveNames(module, rerrs);
  if (hasErrors(rerrs)) throw new Error(`Resolve:\n${formatErrors(rerrs)}`);

  const wasm = encodeWasm(bridgeToBinaryen(module));
  const errs = makeErrorList();
  const decoded = readBinaryIr(wasm, errs);
  if (hasErrors(errs)) throw new Error(`Decode:\n${formatErrors(errs)}`);
  validateModule(decoded, errs, { features: allFeatures() });
  if (hasErrors(errs)) throw new Error(`Validate:\n${formatErrors(errs)}`);

  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm as BufferSource));
  return (inst.exports.f as () => number)();
}

const T = '(type $T (struct (field i32)))';

describe('br_on_* survive the bridge and run', () => {
  // Takes the branch. The block's result is `(ref $T)`, so this is the shape
  // that needed all three fixes.
  it('br_on_cast branches on a successful cast', () => {
    assertEquals(
      bridgeAndRun(`(module ${T} (func (export "f") (result i32)
        (block $l (result (ref $T))
          (br_on_cast $l anyref (ref $T) (struct.new $T (i32.const 9)))
          (return (i32.const 0)))
        (struct.get $T 0)))`),
      9,
    );
  });

  // Falls THROUGH — the cast succeeds, so the "fail" branch is not taken. The
  // block result is the abstract `anyref`, so this one worked from the bridge
  // case alone; it is here to keep the pair honest.
  it('br_on_cast_fail falls through on a successful cast', () => {
    assertEquals(
      bridgeAndRun(`(module ${T} (func (export "f") (result i32)
        (block $l (result anyref)
          (br_on_cast_fail $l anyref (ref $T) (struct.new $T (i32.const 5)))
          (return (struct.get $T 0)))
        (drop) (i32.const 0)))`),
      5,
    );
  });

  it('br_on_null branches on a null reference', () => {
    assertEquals(
      bridgeAndRun(`(module ${T} (func (export "f") (result i32)
        (block $l
          (br_on_null $l (ref.null $T))
          (return (i32.const 1)))
        (i32.const 7)))`),
      7,
    );
  });

  it('br_on_non_null branches on a non-null reference', () => {
    assertEquals(
      bridgeAndRun(`(module ${T} (func (export "f") (result i32)
        (block $l (result (ref $T))
          (br_on_non_null $l (struct.new $T (i32.const 3)))
          (return (i32.const 0)))
        (struct.get $T 0)))`),
      3,
    );
  });
});
