/**
 * @module binaryen-ts/tests/binary/corpus_roundtrip_test
 *
 * Parse → encode → parse over the whole upstream test corpus, asserting that
 * nothing drifts, nothing fails to re-encode, and nothing that validated on the
 * way in fails to validate on the way out.
 *
 * This was `scripts/verify_roundtrip.ts`, kept out of the suite with the note
 * "promote to a real test once the parser is provably clean". It is now: the
 * corpus stands at 80 exact, 0 structural drift, 0 validate failures, and the
 * 10 remaining rejections are deliberate. Leaving it as a script meant nobody
 * ran it, and every one of the WT-2 / UP-series defects it would have caught
 * was instead found by a downstream consumer.
 *
 * **The corpus is gitignored** (`upstream/` is a local reading-room clone), so
 * this test SKIPS when it is absent rather than failing — CI checks out without
 * it. That is deliberate: it makes the test free to keep locally without
 * breaking the published CI run.
 *
 * What it does NOT assert is a fixed pass count. Files legitimately rejected on
 * input (malformed crash fixtures, invalid-magic fuzz inputs, component-model
 * binaries, loud non-MVP rejections) are counted and reconciled, not pinned by
 * name — but the number that successfully round-trip may only go UP. A file
 * that used to parse and stops parsing is a regression and fails here.
 *
 * @license MIT
 */

import { assert, assertEquals } from '@std/assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parseWasm } from '../../src/binary/wasm-parser.ts';
import { encodeWasm } from '../../src/encoder/wasm-encoder.ts';
import { walkExpression } from '../../src/ir/walk.ts';
import type { WasmModule } from '../../src/ir/module.ts';

// `path.fromFileUrl` is Deno-std; this file uses `node:path` for cross-runtime
// parity with the rest of the tree, so convert the URL by hand (matching
// scripts/verify_roundtrip.ts). The leading slash of a Windows file URL
// path ("/D:/...") has to go.
const CORPUS = decodeURIComponent(
  new URL('../../upstream/test', import.meta.url).pathname,
).replace(/^\/(?=[A-Za-z]:)/, '');

/**
 * Lower bound on files that must survive a full round-trip. Raise it when the
 * corpus grows or a rejection is fixed; never lower it to make a run pass.
 */
const MIN_ROUNDTRIPPING = 80;

async function corpusPresent(): Promise<boolean> {
  try {
    const st = await fs.stat(CORPUS);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function findWasm(dir: string, out: string[] = []): Promise<string[]> {
  // Structural type, not `Awaited<ReturnType<typeof fs.readdir>>`: inference
  // picks readdir's Buffer-name overload there, so `e.name` comes back as a
  // Buffer and every string operation on it fails to type-check.
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await findWasm(full, out);
    else if (e.name.endsWith('.wasm')) out.push(full);
  }
  return out;
}

/** Coarse structural fingerprint — what must survive a round-trip. */
function summary(mod: WasmModule): { fns: number; globals: number; data: number; exprs: number } {
  let exprs = 0;
  for (const fn of mod.functions) walkExpression(fn.body, () => void exprs++);
  return {
    fns: mod.functions.length,
    globals: mod.globals.length,
    data: mod.dataSegments.length,
    exprs,
  };
}

async function validates(bytes: Uint8Array): Promise<boolean> {
  try {
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    await WebAssembly.compile(buf);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: 'corpus: parse->encode->parse is lossless and stays valid',
  ignore: !(await corpusPresent()),
  fn: async () => {
    const files = await findWasm(CORPUS);
    assert(files.length > 0, `no .wasm files under ${CORPUS}`);

    const rel = (f: string) => path.relative(CORPUS, f).split(path.sep).join('/');
    const okFiles: string[] = [];
    const rejectedOnInput: string[] = [];
    const encodeFail: string[] = [];
    const reparseFail: string[] = [];
    const drift: string[] = [];
    const validateFail: string[] = [];

    for (const file of files) {
      const buf = new Uint8Array(await fs.readFile(file));

      let mod1: WasmModule;
      try {
        mod1 = parseWasm(buf, file);
      } catch {
        // Deliberate: malformed / non-MVP fixtures fail loudly by design.
        rejectedOnInput.push(rel(file));
        continue;
      }

      let bytes2: Uint8Array;
      try {
        bytes2 = encodeWasm(mod1);
      } catch (e) {
        encodeFail.push(`${rel(file)}: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }

      let mod2: WasmModule;
      try {
        mod2 = parseWasm(bytes2, file);
      } catch (e) {
        reparseFail.push(`${rel(file)}: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }

      // Only hold the output to the standard the INPUT already met.
      if (await validates(buf) && !await validates(bytes2)) {
        validateFail.push(rel(file));
      }

      const a = summary(mod1);
      const b = summary(mod2);

      // Entity counts are exact: no round-trip may add or drop a function,
      // global, or data segment.
      if (a.fns !== b.fns || a.globals !== b.globals || a.data !== b.data) {
        drift.push(`${rel(file)}: entities ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
        continue;
      }

      // Expression counts are checked for CONVERGENCE, not equality. Some
      // constructs are legitimately REWRITTEN on decode — a block/loop/if with
      // parameters is spilled to locals, and a mixed-target `br_table` becomes
      // a dispatch trampoline — which adds `local.set`/`local.get` nodes on the
      // first trip. What must never happen is growth that keeps going: the
      // `unreachable-pops` defect added an expression on EVERY trip. So compare
      // generation 1 against generation 2.
      let c = b;
      if (a.exprs !== b.exprs) {
        try {
          c = summary(parseWasm(encodeWasm(mod2), file));
        } catch (e) {
          reparseFail.push(`${rel(file)}: gen3 ${(e as Error).message.slice(0, 100)}`);
          continue;
        }
      }
      if (b.exprs !== c.exprs) {
        drift.push(
          `${rel(file)}: expressions did not converge ${a.exprs} -> ${b.exprs} -> ${c.exprs}`,
        );
      } else {
        okFiles.push(rel(file));
      }
    }

    assertEquals(encodeFail, [], 'encode failures');
    assertEquals(reparseFail, [], 're-parse failures');
    assertEquals(drift, [], 'structural drift across the round-trip');
    assertEquals(validateFail, [], 'output failed to validate though the input did');

    // Every file lands in exactly one bucket — the old script silently dropped
    // input-rejected files, so its "0 failures" could hide unexercised inputs.
    assertEquals(
      okFiles.length + rejectedOnInput.length + encodeFail.length +
        reparseFail.length + drift.length,
      files.length,
      'some files fell through every category',
    );

    assert(
      okFiles.length >= MIN_ROUNDTRIPPING,
      `only ${okFiles.length} files round-tripped, expected at least ${MIN_ROUNDTRIPPING} — ` +
        `a file that used to parse now does not. Rejected on input:\n  ${
          rejectedOnInput.join('\n  ')
        }`,
    );
  },
});
