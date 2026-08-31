// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * A3 — measures where the binary reader points when it rejects a module.
 *
 * ## Why this exists, and why the first attempt did not
 *
 * T13.35 tried to measure this with a cheap oracle — *is the reported offset
 * near the corrupted byte?* It flagged 32 cases, every one of which turned out
 * to be **correct**: for a malformed multi-byte construct, reporting the START
 * of the construct beats reporting where the decoder happened to stop. The
 * oracle scored the right answer as wrong, so it was abandoned — and the axis
 * was recorded as UNMEASURED rather than clean, which is the only honest label
 * for "we tried, the instrument was broken, and we built no replacement".
 *
 * This is the replacement. **It reports a distribution, not a verdict**, because
 * the thing the old attempt got wrong was believing a single number could carry
 * the judgement.
 *
 * ## Method
 *
 * Single-byte corruption sweep. For each byte of a valid module, flip it and
 * ask the reader to decode the result, recording:
 *
 *   - whether it was rejected at all (an ACCEPTED corruption is either a legal
 *     alternative encoding or a missed rejection — counted separately, because
 *     that question is more serious than offset accuracy);
 *   - `delta = reportedOffset - corruptedByte`.
 *
 * ## What delta means, and does NOT
 *
 * **`delta` is not an error score.** Read it as a shape:
 *
 *   - `delta == 0` — reported exactly at the corrupted byte;
 *   - `delta < 0`  — reported UPSTREAM. Usually the start of the construct the
 *     corrupted byte belongs to. **This is frequently the better diagnostic**,
 *     and is precisely what the old oracle penalised;
 *   - `delta > 0`  — reported DOWNSTREAM: the decoder consumed the corrupt byte
 *     as though it were valid and failed later. Large positive deltas are the
 *     genuinely interesting ones, because the message will describe a construct
 *     that is not the one that is wrong.
 *
 * So: **large positive deltas are the signal.** Everything else needs a human.
 *
 * ```sh
 * deno task offsets            # summary
 * deno task offsets --verbose  # plus the worst downstream cases
 * ```
 */

import { readBinaryIr } from '../src/wabt-ts/reader/binary-reader-ir.ts';
import { hasErrors, makeErrorList } from '../src/wabt-ts/core/error.ts';
import { validateModule } from '../src/wabt-ts/validator/validator.ts';
import { allFeatures } from '../src/wabt-ts/core/feature.ts';
import { wat2wasm } from '../src/wabt-ts/tools/wat2wasm.ts';

/** Modules chosen to span single-byte fields, multi-byte LEBs, and nested constructs. */
const SUBJECTS: ReadonlyArray<readonly [string, string]> = [
  ['minimal', '(module (func (export "f") (result i32) (i32.const 7)))'],
  [
    'multi-byte LEBs',
    '(module (memory 1) (func (export "f") (result i32) (i32.const 1000000) (i32.load offset=100000)))',
  ],
  [
    'nested control',
    `(module (func (export "f") (param i32) (result i32)
       (block $a (result i32) (loop $b (result i32)
         (if (result i32) (local.get 0) (then (br $a (i32.const 1))) (else (br $b)))))))`,
  ],
  [
    'GC types',
    `(module (type $T (struct (field i32) (field i64)))
       (func (export "f") (result i32) (struct.get $T 0 (struct.new $T (i32.const 3) (i64.const 4)))))`,
  ],
  [
    'tables and elems',
    `(module (table 4 funcref) (elem (i32.const 0) $g $g)
       (func $g (result i32) (i32.const 1))
       (func (export "f") (result i32) (call $g)))`,
  ],
];

interface Row {
  subject: string;
  /** Byte index that was corrupted. */
  at: number;
  /** `reportedOffset - at`, or null when nothing was reported. */
  delta: number | null;
  accepted: boolean;
  message: string;
}

/** Decode one corrupted variant and classify the outcome. */
function probe(subject: string, bytes: Uint8Array, at: number): Row {
  const v = bytes.slice();
  v[at] = v[at]! ^ 0xff;
  const errs = makeErrorList();
  try {
    readBinaryIr(v, errs);
  } catch (e) {
    // A throw is still a rejection; it just carries no offset.
    return { subject, at, delta: null, accepted: false, message: `throw: ${(e as Error).message}` };
  }
  if (!hasErrors(errs)) {
    // ACCEPTED BY THE READER. That alone is not a defect: readBinaryIr only
    // DECODES. Rejecting a semantically invalid module is the validator's job,
    // and comparing a reader against V8 -- which decodes AND validates -- would
    // book every validator-caught case as a reader defect. So run our validator
    // too, and only call it a MISSED REJECTION when our whole pipeline accepts a
    // module V8 refuses.
    const verrs = makeErrorList();
    try {
      validateModule(readBinaryIr(v, makeErrorList()), verrs, { features: allFeatures() });
    } catch {
      return { subject, at, delta: null, accepted: false, message: 'validator threw' };
    }
    if (hasErrors(verrs)) {
      return { subject, at, delta: null, accepted: false, message: 'caught by validator' };
    }
    const v8ok = WebAssembly.validate(v as BufferSource);
    return { subject, at, delta: null, accepted: true, message: v8ok ? 'v8:valid' : 'v8:REJECTS' };
  }
  const first = errs[0]!;
  return {
    subject,
    at,
    delta: first.loc.offset - at,
    accepted: false,
    message: first.message,
  };
}

const verbose = Deno.args.includes('--verbose');
const unknown = Deno.args.filter((a) => a !== '--verbose');
if (unknown.length > 0) {
  console.error(`offsets: unrecognised argument(s): ${unknown.join(' ')}`);
  Deno.exit(2);
}

const rows: Row[] = [];
for (const [name, wat] of SUBJECTS) {
  const { binary, errors } = wat2wasm(wat, { filename: `${name}.wat` });
  if (hasErrors(errors)) {
    console.error(`offsets: subject ${name} does not assemble; fix the fixture`);
    Deno.exit(1);
  }
  // Skip the 8-byte magic+version: corrupting those is a different question.
  for (let i = 8; i < binary.length; i++) rows.push(probe(name, binary, i));
}

const rejected = rows.filter((r) => !r.accepted);
const withOffset = rejected.filter((r) => r.delta !== null) as (Row & { delta: number })[];
const accepted = rows.filter((r) => r.accepted);
const noOffset = rejected.length - withOffset.length;

// The reader's offset is `pos` AFTER the failing read, so a report "at" the
// corrupted byte lands a read-width later, not at delta 0. Treating 0 as the
// only good answer is the same class of oracle mistake T13.35 made.
const AT_CONSTRUCT = 4;

// Corrupting a LENGTH field makes the reader consume to the end of input and
// report `unexpected end of binary` at the buffer end. The delta is then just
// (length - at) -- an artifact of where the corruption sits, carrying nothing
// about diagnostic quality. Bucketed out, or it dominates the distribution and
// hides the cases that matter.
const isEof = (r: Row) => r.message.includes('unexpected end of binary');
const eof = withOffset.filter(isEof);
const specific = withOffset.filter((r) => !isEof(r));

const atConstruct = specific.filter((r) => r.delta > 0 && r.delta <= AT_CONSTRUCT);
const upstream = specific.filter((r) => r.delta < 0);
const downstream = specific.filter((r) => r.delta > AT_CONSTRUCT);
const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;

console.log(`\nA3 — diagnostic offset shape, ${rows.length} single-byte corruptions\n`);
console.log(`  rejected                 ${rejected.length}  (${pct(rejected.length)})`);
console.log(`  ACCEPTED (no diagnostic) ${accepted.length}  (${pct(accepted.length)})`);
console.log(`  rejected without offset  ${noOffset}`);
console.log(`\n  of the ${withOffset.length} rejections carrying an offset:`);
console.log(
  `    'unexpected end of binary'  ${eof.length}  — length-field corruption; delta is an artifact, excluded`,
);
console.log(`  of the ${specific.length} carrying a SPECIFIC diagnostic:`);
console.log(`    delta 1..${AT_CONSTRUCT}  (at the construct)         ${atConstruct.length}`);
console.log(`    delta <  0  (upstream — often BETTER) ${upstream.length}`);
console.log(`    delta >  ${AT_CONSTRUCT}  (downstream — THE SIGNAL)  ${downstream.length}`);

if (downstream.length > 0) {
  const sorted = [...downstream].sort((a, b) => b.delta - a.delta);
  console.log(`\n  worst downstream deltas (decoder ran past the corruption):`);
  for (const r of sorted.slice(0, verbose ? 25 : 8)) {
    console.log(
      `    +${String(r.delta).padStart(4)}  ${r.subject.padEnd(16)} @${r.at}  ${
        r.message.slice(0, 58)
      }`,
    );
  }
}

if (accepted.length > 0) {
  console.log(`\n  ⚠️ corruptions ACCEPTED without any diagnostic:`);
  if (verbose) {
    for (const r of accepted) console.log(`    ${r.subject.padEnd(16)} @${r.at}  ${r.message}`);
  }
  const missed = accepted.filter((r) => r.message === 'v8:REJECTS');
  console.log(
    `    V8 also accepts these (legal alternative encodings): ${accepted.length - missed.length}`,
  );
  console.log(`    V8 REJECTS these — MISSED REJECTIONS:                 ${missed.length}`);
  for (const r of missed) console.log(`      ${r.subject.padEnd(16)} @${r.at}`);
  if (missed.length > 0) {
    console.log(
      `    A missed rejection is a fail-loud defect and outranks every offset` +
        ` number above it.`,
    );
  }
}

console.log(
  `\n  Reported, not gated. delta is a shape, not a score: a negative delta is\n` +
    `  usually the start of the offending construct and is the better diagnostic.\n`,
);
