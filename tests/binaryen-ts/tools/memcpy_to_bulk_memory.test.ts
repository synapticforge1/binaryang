// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// `wasm-opt --memcpy-to-bulk-memory` (open-work 37). The owner's conditions, 2026-10-24: "if the
// rewrite from the tinygo implementation does not change the runtime result, I agree", and
// "exact code match only". So: the catalogue IS the committed TinyGo builds' code; one changed
// byte, or a memmove whose memcpy is not recognised, is left alone; other compilers' output is
// untouched; and for every DEFINED call the original and the rewritten function leave the same
// memory and return the same value (overlap for memcpy and out-of-bounds are the two cases the
// owner accepted as different — "1 is acceptable" — and are not called here).

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync } from 'node:fs';
import {
  knownCopyFunctions,
  memcpyToBulkMemory,
} from '../../../src/tools/memcpy-to-bulk-memory.ts';
import { readForPasses } from '../../../src/ir/prepare.ts';
import { writeWasm } from '../../../src/ir/write-wasm.ts';
import { varName } from '../../../src/ir/ir.ts';
import { ExternalKind } from '../../../src/core/binary.ts';
import { wasmOpt } from '../../../src/tools/wasm-opt.ts';

const MODULES = new URL('../../../benches/browser-opt/modules/', import.meta.url);
const load = (name: string) => new Uint8Array(readFileSync(new URL(`${name}.wasm`, MODULES)));
const recognised = (bytes: Uint8Array) => {
  const m = readForPasses(bytes);
  return [...knownCopyFunctions(bytes, m)].map(([k, kind]) => `${m.functions[k]!.name}:${kind}`)
    .sort();
};
const CHECKSUM = 1892226719; // run(300) of every original (wasmtime, V8, JavaScriptCore agree)

describe('the catalogue is the committed TinyGo code, and nothing else matches', () => {
  it('TinyGo opt1: memcpy and memmove; optz: memcpy', () => {
    expect(recognised(load('tinygo-opt1'))).toEqual(['$memcpy:memcpy', '$memmove:memmove']);
    expect(recognised(load('tinygo-optz'))).toEqual(['$memcpy:memcpy']);
  });

  it('Rust and Zig output: nothing', () => {
    for (const m of ['rust-debug', 'rust-release', 'zig-debug', 'zig-releasefast']) {
      expect(`${m}: ${recognised(load(m)).length}`).toBe(`${m}: 0`);
    }
  });

  it('one byte changed in memcpy: no match — and then memmove, which calls it, none either', () => {
    const bytes = load('tinygo-opt1');
    const m = readForPasses(bytes);
    const k = m.functions.findIndex((f) => f.name === '$memcpy');
    // Its body starts `01 05 7f 41 00`: five i32 locals, then `i32.const 0`. Make it `i32.const 1` —
    // one byte, and still a VALID module (a flip elsewhere can break it, which tests nothing).
    const at = m.functions[k]!.loc!.offset! + 4;
    expect([...bytes.slice(at - 4, at + 1)]).toEqual([0x01, 0x05, 0x7f, 0x41, 0x00]);
    const changed = bytes.slice();
    changed[at] = 0x01;
    expect(recognised(changed).filter((r) => r.startsWith('$memcpy') || r.startsWith('$memmove')))
      .toEqual([]);
  });

  it('names play no part: a module written without names matches the same', () => {
    const m = readForPasses(load('tinygo-opt1'));
    m.hasNameSection = false;
    const bytes = writeWasm(m);
    expect(recognised(bytes).map((r) => r.split(':')[1])).toEqual(['memcpy', 'memmove']);
  });
});

describe('the runtime result does not change', () => {
  for (const name of ['tinygo-opt1', 'tinygo-optz']) {
    it(`${name}: the workload's checksum, and smaller`, async () => {
      const original = load(name);
      const out = (await wasmOpt(original, { memcpyToBulkMemory: true })) as Uint8Array;
      expect(out.length).toBeLessThan(original.length - 1000);
      const { instance } = await WebAssembly.instantiate(out as BufferSource, {});
      const ex = instance.exports as { _initialize(): void; run(n: number): number };
      ex._initialize();
      expect(ex.run(300)).toBe(CHECKSUM);
    });
  }

  it('every defined call: the same memory and the same return value, original against rewritten', async () => {
    // Export the copy functions and the memory from both variants, then call each on a grid.
    const variant = async (rewrite: boolean) => {
      const bytes = load('tinygo-opt1');
      const m = readForPasses(bytes);
      if (rewrite) expect(memcpyToBulkMemory(bytes, m).sort()).toEqual(['$memcpy', '$memmove']);
      m.exports.push({ name: 'xmemcpy', kind: ExternalKind.Func, var: varName('$memcpy') });
      m.exports.push({ name: 'xmemmove', kind: ExternalKind.Func, var: varName('$memmove') });
      const { instance } = await WebAssembly.instantiate(writeWasm(m) as BufferSource, {});
      return instance.exports as {
        memory: WebAssembly.Memory;
        xmemcpy(d: number, s: number, n: number): number;
        xmemmove(d: number, s: number, n: number): number;
      };
    };
    const [a, b] = [await variant(false), await variant(true)];
    // A scratch area far from TinyGo's data: 64 KiB up.
    const BASE = 65536;
    const fill = (mem: WebAssembly.Memory) => {
      const v = new Uint8Array(mem.buffer, BASE, 512);
      for (let i = 0; i < v.length; i++) v[i] = (i * 37 + 11) & 0xff;
    };
    const snap = (mem: WebAssembly.Memory) => [...new Uint8Array(mem.buffer, BASE, 512)];
    let calls = 0;
    for (const fn of ['xmemcpy', 'xmemmove'] as const) {
      for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64]) {
        for (const d of [0, 1, 2, 3, 4, 100]) {
          for (const s of [0, 1, 2, 3, 4, 200, 230]) {
            const dst = BASE + 128 + d, src = BASE + 128 + s;
            const overlap = dst < src + n && src < dst + n;
            if (fn === 'xmemcpy' && overlap && n > 0) continue; // undefined in C: accepted as different
            fill(a.memory);
            fill(b.memory);
            const ra = a[fn](dst, src, n), rb = b[fn](dst, src, n);
            expect(`${fn}(${d}, ${s}, ${n}) -> ${rb}`).toBe(`${fn}(${d}, ${s}, ${n}) -> ${ra}`);
            expect(snap(b.memory)).toEqual(snap(a.memory));
            calls++;
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(1000);
  });
});
