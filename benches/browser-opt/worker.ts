// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Runs in a module WEB WORKER (open-work 28.6), as the use case would: a page optimizing a module
 * on the user's machine, off the main thread. For each test module, five variants: the original;
 * binaryang's `wasmOpt` at -O2 and -Oz, run and TIMED here in the browser; upstream wasm-opt's -O2
 * and -Oz, made on the host (the quality reference). For each: size, `WebAssembly.compile` time,
 * the `run(N)` workload time (medians), and whether the checksum equals the original's.
 */

export interface VariantResult {
  variant: string;
  bytes: number;
  // The bytes outside custom sections, and those sections' names: the debug builds are mostly
  // DWARF, which upstream's reference drops (`--strip-dwarf`), so `bytes` alone compares debug info.
  codeBytes: number;
  custom: string[];
  optimizeMs?: number; // binaryang variants: the in-browser wasmOpt time
  compileMs: number;
  runMs: number;
  checksum: number | string;
  sameResult: boolean;
}
export interface ModuleReport {
  module: string;
  variants: VariantResult[];
}

type WasmOpt = (bytes: Uint8Array, o: Record<string, unknown>) => Promise<Uint8Array | string>;

const REPEAT = 5;
const N = 300;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The binary's custom sections: their total size (headers included) and names. */
function customSections(b: Uint8Array): { size: number; names: string[] } {
  const leb = (at: number): [number, number] => {
    let v = 0;
    let shift = 0;
    let i = at;
    for (;;) {
      const byte = b[i++]!;
      v += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if ((byte & 0x80) === 0) return [v, i];
    }
  };
  let size = 0;
  const names: string[] = [];
  let p = 8;
  while (p < b.length) {
    const start = p;
    const id = b[p++]!;
    const [len, body] = leb(p);
    p = body + len;
    if (id !== 0) continue;
    size += p - start;
    const [nameLen, nameAt] = leb(body);
    names.push(new TextDecoder().decode(b.subarray(nameAt, nameAt + nameLen)));
  }
  return { size, names };
}

async function timeCompile(bytes: Uint8Array): Promise<{ ms: number; mod: WebAssembly.Module }> {
  const times: number[] = [];
  let mod!: WebAssembly.Module;
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    mod = await WebAssembly.compile(bytes as BufferSource);
    times.push(performance.now() - t0);
  }
  return { ms: median(times), mod };
}

async function timeRun(mod: WebAssembly.Module): Promise<{ ms: number; checksum: number }> {
  const times: number[] = [];
  let checksum = 0;
  for (let i = 0; i < REPEAT; i++) {
    // A fresh instance each time: the workload allocates, and no run should inherit a heap.
    const inst = await WebAssembly.instantiate(mod, {});
    const ex = inst.exports as Record<string, unknown>;
    if (typeof ex['_initialize'] === 'function') (ex['_initialize'] as () => void)();
    const run = ex['run'] as (n: number) => number;
    const t0 = performance.now();
    checksum = run(N);
    times.push(performance.now() - t0);
  }
  return { ms: median(times), checksum };
}

async function measure(
  variant: string,
  bytes: Uint8Array,
  expected: number | undefined,
  optimizeMs?: number,
): Promise<VariantResult> {
  const cs = customSections(bytes);
  const sizes = { bytes: bytes.length, codeBytes: bytes.length - cs.size, custom: cs.names };
  try {
    const c = await timeCompile(bytes);
    const r = await timeRun(c.mod);
    return {
      variant,
      ...sizes,
      optimizeMs,
      compileMs: c.ms,
      runMs: r.ms,
      checksum: r.checksum,
      sameResult: expected === undefined || r.checksum === expected,
    };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return {
      variant,
      ...sizes,
      optimizeMs,
      compileMs: NaN,
      runMs: NaN,
      checksum: `error: ${msg}`,
      sameResult: false,
    };
  }
}

const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function main(): Promise<ModuleReport[]> {
  // A runtime URL, not a literal: the bundler must not try to resolve the served bundle at build time.
  const bundle = new URL('/bundles/tools_wasm-opt.js', self.location.origin).href;
  const wasmOpt = ((await import(bundle)) as { wasmOpt: WasmOpt }).wasmOpt;
  const modules = (await (await fetch('/modules.json')).json()) as string[];
  const reports: ModuleReport[] = [];
  for (const m of modules) {
    const original = await fetchBytes(`/modules/${m}.wasm`);
    const base = await measure('original', original, undefined);
    const expected = typeof base.checksum === 'number' ? base.checksum : undefined;
    const variants = [base];
    for (
      const [name, opts] of [
        ['binaryang -O2', { optimizeLevel: 2, shrinkLevel: 0 }],
        ['binaryang -Oz', { optimizeLevel: 2, shrinkLevel: 2 }],
      ] as const
    ) {
      try {
        const t0 = performance.now();
        const out = await wasmOpt(original, { ...opts, validate: false });
        const ms = performance.now() - t0;
        if (typeof out === 'string') throw new Error('wasmOpt returned text');
        variants.push(await measure(name, out, expected, ms));
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        variants.push({
          variant: name,
          bytes: 0,
          codeBytes: 0,
          custom: [],
          compileMs: NaN,
          runMs: NaN,
          checksum: `error: ${msg}`,
          sameResult: false,
        });
      }
    }
    for (const level of ['O2', 'Oz']) {
      variants.push(
        await measure(
          `upstream -${level}`,
          await fetchBytes(`/upstream/${m}.${level}.wasm`),
          expected,
        ),
      );
    }
    reports.push({ module: m, variants });
  }
  return reports;
}

main().then(
  (reports) => postMessage({ reports }),
  (e) => postMessage({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }),
);
