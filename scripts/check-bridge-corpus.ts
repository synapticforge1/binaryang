// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * S6's acceptance gate: how much of the corpus survives the bridge path?
 *
 * `wat2wasm` and the byte baseline measure wabt-ts alone. This measures the
 * OTHER path — wabt-ts parses, the bridge translates to binaryen-ts's IR, and
 * binaryen-ts encodes — which is the path S6 deletes by making the two IRs one.
 *
 * ⚠️ **Built before the step that depends on it, deliberately.** C10a recorded
 * "24 modules the bridge mistranslates" as a remembered number from an ad-hoc
 * run; S6's stated acceptance criterion is that those modules round-trip once
 * the type is unified. A criterion nothing measures is not a criterion, and S1
 * established the rule: the gate exists before anything depends on it.
 *
 * The diagnosis this gate has to be able to falsify is that the fault is in the
 * TRANSLATION rather than in either IR. If S6 lands and the same modules still
 * fail, that diagnosis was wrong.
 *
 * Usage: `deno task bridge`
 */

import { parseWatModule } from '../src/wabt-ts/parser/wast-parser.ts';
import { resolveNames } from '../src/wabt-ts/ir/resolve-names.ts';
import { synthesizeTypes } from '../src/wabt-ts/ir/synthesize-types.ts';
import { bridgeToBinaryen } from '../src/bridge/bridge.ts';
import { encodeWasm } from '../src/binaryen-ts/encoder/index.ts';

const CORPUS = new URL('../tests/wabt-ts/wasmtk/', import.meta.url);

/** Where a module stopped. Ordered by how early the failure is. */
type Outcome = 'parse' | 'bridge' | 'encode' | 'invalid' | 'ok';

interface Row {
  file: string;
  outcome: Outcome;
  detail: string;
}

function classify(file: string, wat: string): Row {
  const parsed = parseWatModule(wat);
  if (!parsed.module) return { file, outcome: 'parse', detail: 'wabt-ts could not parse' };
  resolveNames(parsed.module);
  // ⚠️ `wat2wasm` is parse -> resolveNames -> synthesizeTypes -> write. Leaving
  // this step out makes modules fail that the real pipeline handles, and the
  // failures look like bridge faults. Measure the path that exists.
  synthesizeTypes(parsed.module);

  let bridged;
  try {
    bridged = bridgeToBinaryen(parsed.module);
  } catch (e) {
    return { file, outcome: 'bridge', detail: (e as Error).message };
  }

  let bytes: Uint8Array;
  try {
    bytes = encodeWasm(bridged);
  } catch (e) {
    return { file, outcome: 'encode', detail: (e as Error).message };
  }

  // The ENGINE is the oracle here, not our own validator: a module our
  // validator accepts and V8 rejects is still a failure, and vice versa is
  // worth knowing about.
  if (!WebAssembly.validate(bytes as BufferSource)) {
    // `validate` returns a bare boolean, which makes 19 different faults look
    // like one. Compiling throws with the engine's actual complaint, and a
    // reason you can group is what turns a count into a diagnosis.
    let why = 'engine rejected it';
    try {
      new WebAssembly.Module(bytes as BufferSource);
    } catch (e) {
      why = (e as Error).message;
    }
    return { file, outcome: 'invalid', detail: why };
  }
  return { file, outcome: 'ok', detail: '' };
}

const rows: Row[] = [];
for await (const entry of Deno.readDir(CORPUS)) {
  if (!entry.isFile || !entry.name.endsWith('.wat')) continue;
  const wat = await Deno.readTextFile(new URL(entry.name, CORPUS));
  try {
    rows.push(classify(entry.name, wat));
  } catch (e) {
    // An unexpected throw is itself a finding; never let one file hide the rest.
    rows.push({
      file: entry.name,
      outcome: 'bridge',
      detail: `unexpected: ${(e as Error).message}`,
    });
  }
}

rows.sort((a, b) => a.file.localeCompare(b.file));
const by = (o: Outcome) => rows.filter((r) => r.outcome === o);
const ok = by('ok').length;
const total = rows.length;

console.log('  === bridge path: wabt-ts parse -> bridge -> binaryen-ts encode -> engine ===');
console.log(`    round-trips           ${String(ok).padStart(4)} / ${total}`);
for (const o of ['parse', 'bridge', 'encode', 'invalid'] as const) {
  const n = by(o).length;
  if (n > 0) console.log(`    failed at ${o.padEnd(10)} ${String(n).padStart(4)}`);
}

const failures = rows.filter((r) => r.outcome !== 'ok');
if (failures.length > 0) {
  console.log(`\n  === the ${failures.length} that do not (first 30) ===`);
  for (const r of failures.slice(0, 30)) {
    console.log(`    ${r.outcome.padEnd(8)} ${r.file.padEnd(42)} ${r.detail.slice(0, 100)}`);
  }
  // Group the reasons: one root cause usually explains many files.
  const reasons = new Map<string, number>();
  for (const r of failures) {
    const key = r.detail.replace(/\d+/g, 'N').slice(0, 140);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log('\n  === distinct reasons ===');
  for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}x  ${k}`);
  }
}

if (ok === total) console.log('\n  TOTAL — every corpus module survives the bridge path.');
