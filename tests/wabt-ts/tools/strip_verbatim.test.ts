// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Open-work 45 (divergence ST1, DEFECT by the owner, 2026-10-26): `wasm-strip` removes custom
// sections and must leave every other byte as it was. It used to decode the module and write it
// back, so LLVM's relocation-padded LEBs came out minimal: the code changed, and a KEPT section
// that names code offsets (`reloc.CODE`, `.debug_line`) went stale — `wasm-bundle` refused a
// relocatable module after `wasm-strip -s name`. Upstream wabt's `wasm-strip` only locates the
// custom sections and copies the rest.
//
// The oracle is upstream wabt 1.0.41 itself: the SHA-256 of its output on two committed modules,
// recorded once (2026-10-26), so the test needs no wabt install.

import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assert, assertEquals } from '@std/assert';

import { wasmStrip } from '../../../src/tools/wasm-strip.ts';
import { wasmBundle } from '../../../src/tools/wasm-bundle.ts';
import { Result } from '../../../src/core/result.ts';
import { formatErrors, hasErrors } from '../../../src/core/error.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function strip(bytes: Uint8Array, sections?: string[]): Uint8Array {
  const r = wasmStrip(bytes, sections ? { sections } : {});
  assert(!hasErrors(r.errors), formatErrors(r.errors));
  assertEquals(r.result, Result.Ok);
  return r.binary;
}

describe('open-work 45 — wasm-strip copies what it keeps, byte for byte', () => {
  it('a padded LEB in a kept section survives (hand-built: count 1 as 81 80 80 80 00)', () => {
    const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    // type section: one `(func)`, its count written padded to five bytes, as a linker leaves it
    const types = [0x01, 0x08, 0x81, 0x80, 0x80, 0x80, 0x00, 0x60, 0x00, 0x00];
    const custom = [0x00, 0x03, 0x01, 0x78, 0x07]; // custom "x", payload 07
    const input = new Uint8Array([...header, ...types, ...custom]);
    assertEquals([...strip(input)], [...header, ...types]);
    assertEquals([...strip(input, ['x'])], [...header, ...types]);
    assertEquals([...strip(input, ['other'])], [...input]);
  });

  it('strip everything = upstream wabt 1.0.41 `wasm-strip`, on LLVM output', () => {
    const cases: [string, string][] = [
      [
        'tests/binaryen-ts/tools/fixtures/bundle/strbin_rust.wasm',
        '424aad5f4c301f0a64a2efca44081cc43b45ccfc26d70e81bacc2b35d028093b',
      ],
      [
        'tests/binaryen-ts/tools/fixtures/bundle/mathlib_zig.wasm',
        '0ced2f06c71c25db274f43a8d8a15edc26acbac1f5748c066d1e467ea1cd2957',
      ],
      [
        'benches/browser-opt/modules/rust-release.wasm',
        '11d1360e9973748bb064822c795aecd7cd9ff4723687f5afd6a7a84f74021d8a',
      ],
    ];
    for (const [rel, upstream] of cases) {
      assertEquals(sha(strip(new Uint8Array(readFileSync(fixture(rel))))), upstream, rel);
    }
  });

  it('`-s name` = upstream `wasm-strip -R name`, and the module still bundles', async () => {
    const input = new Uint8Array(
      readFileSync(fixture('tests/binaryen-ts/tools/fixtures/bundle/strbin_rust.wasm')),
    );
    const out = strip(input, ['name']);
    assertEquals(sha(out), '24c2d3978e90bcb2287852faf68ac23d351eb966c2a3623080e83434d09f4235');
    // The user-visible failure: its reloc.CODE / reloc.DATA were kept, so their offsets must
    // still name the right bytes, which wasm-bundle verifies before it relocates anything.
    const dir = mkdtempSync(join(tmpdir(), 'binaryang-strip45-'));
    try {
      const path = join(dir, 'strbin_rust.wasm');
      writeFileSync(path, out);
      const { report } = await wasmBundle([path], { log: undefined });
      assertEquals(report.inputs.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
