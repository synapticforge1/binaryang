// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Runs IN THE BROWSER (open-work 28.3). Bundled by `check-browsers.ts` for the browser target and
 * served with the export bundles; it never imports the library directly, it LOADS the bundles a
 * page would, by URL, so what is tested is what ships.
 *
 * It reports, on `globalThis.__result`:
 * - which export bundles load and which throw;
 * - the smoke module's `wat2wasm` SHA-256 (it must equal the Deno / Node / Bun hash);
 * - per corpus module: the SHA-256 of `wat2wasm`'s bytes and of `wasmOpt -O2`'s, and whether THIS
 *   browser's engine accepts each (`WebAssembly.validate`). The hashes must equal the host's; an
 *   engine refusal is a browser difference, allowed only where listed;
 * - the README's browser recipe (examples/browser-optimize, open-work 28.7), run as a page runs it:
 *   its bundles loaded by URL, its Worker started, on the first RECIPE_MODULES corpus modules
 *   (twice each: the second must come from the cache) and on the three ways it must keep the
 *   original (malformed bytes, bytes that are not a binary, a time limit it cannot meet).
 */

// The recipe's shape as this harness uses it, declared here rather than imported: the recipe
// imports the PUBLISHED specifier, which only examples/browser-optimize/tsconfig.json resolves.
interface OptimizeInBrowserOptions {
  workerUrl?: string;
  cacheName?: string | null;
  timeoutMs?: number;
}
interface OptimizeInBrowserResult {
  bytes: Uint8Array;
  optimized: boolean;
  fromCache: boolean;
  reason: string;
}
import { RECIPE_MODULES } from './shared.ts';

export interface RecipeRun {
  file: string;
  first: { hash: string; optimized: boolean; fromCache: boolean; reason: string };
  second: { hash: string; optimized: boolean; fromCache: boolean; reason: string };
}
export interface RecipeResult {
  runs: RecipeRun[];
  /** Each must keep the original: `same` is whether the returned bytes ARE the input's. */
  kept: {
    case: 'malformed' | 'not-binary' | 'timeout' | 'already-optimized';
    optimized: boolean;
    same: boolean;
    reason: string;
  }[];
  error?: string;
}

export interface ModuleResult {
  file: string;
  wat2wasm: string; // sha256 hex, or "error: …"
  opt: string; // sha256 hex, or "error: …"
  valid: boolean;
  optValid: boolean;
}
export interface HarnessResult {
  userAgent: string;
  loaded: string[];
  loadFailed: [string, string][];
  smoke: string;
  modules: ModuleResult[];
  recipe?: RecipeResult;
  error?: string;
}

type OptimizeInBrowser = (
  b: Uint8Array,
  o?: OptimizeInBrowserOptions,
) => Promise<OptimizeInBrowserResult>;

/** The recipe, loaded and run the way a page would. */
async function runRecipe(inputs: [string, Uint8Array][]): Promise<RecipeResult> {
  const out: RecipeResult = { runs: [], kept: [] };
  const cacheName = `binaryang-recipe-test-${Date.now()}`;
  try {
    // A computed URL, as for the exports: the bundler must not resolve it, the page loads it.
    const url = new URL('/recipe/optimize.js', location.href).href;
    const mod = (await import(url)) as { optimizeInBrowser: OptimizeInBrowser };
    const opts: OptimizeInBrowserOptions = { workerUrl: '/recipe/optimize-worker.js', cacheName };
    const view = async (r: OptimizeInBrowserResult) => ({
      hash: await hex(r.bytes),
      optimized: r.optimized,
      fromCache: r.fromCache,
      reason: r.reason,
    });
    let firstOutput: Uint8Array | undefined;
    for (const [file, bin] of inputs) {
      const r1 = await mod.optimizeInBrowser(bin, opts);
      firstOutput ??= r1.optimized ? r1.bytes : undefined;
      const first = await view(r1);
      const second = await view(await mod.optimizeInBrowser(bin, opts));
      out.runs.push({ file, first, second });
    }
    const keep = async (c: RecipeResult['kept'][number]['case'], b: Uint8Array, o = opts) => {
      const r = await mod.optimizeInBrowser(b, o);
      out.kept.push({ case: c, optimized: r.optimized, same: r.bytes === b, reason: r.reason });
    };
    // A wasm header and version, then a section id with an impossible size.
    await keep(
      'malformed',
      new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff, 0x0f]),
    );
    // WAT text, padded so that `wasmOpt` WOULD shrink it if the recipe let text through.
    await keep('not-binary', new TextEncoder().encode(`(module ${' '.repeat(200)}(func))`));
    const first = inputs[0]?.[1];
    if (first) await keep('timeout', first, { ...opts, cacheName: null, timeoutMs: 1 });
    // The recipe's own output, again: -Oz does not shrink it further (the host checks that), so
    // this is the "no smaller" path.
    if (firstOutput) await keep('already-optimized', firstOutput, { ...opts, cacheName: null });
  } catch (e) {
    out.error = message(e);
  } finally {
    if ('caches' in globalThis) await caches.delete(cacheName).catch(() => false);
  }
  return out;
}

type Wat2Wasm = (src: string) => { binary?: Uint8Array; errors: { message: string }[] };
type WasmOpt = (bytes: Uint8Array, o: Record<string, unknown>) => Promise<Uint8Array | string>;

const hex = async (bytes: Uint8Array): Promise<string> => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function run(): Promise<HarnessResult> {
  const result: HarnessResult = {
    userAgent: navigator.userAgent,
    loaded: [],
    loadFailed: [],
    smoke: '',
    modules: [],
  };
  const exportsList = (await (await fetch('/exports.json')).json()) as [string, string][];
  const mods = new Map<string, Record<string, unknown>>();
  for (const [sub, url] of exportsList) {
    try {
      mods.set(sub, (await import(url)) as Record<string, unknown>);
      result.loaded.push(sub);
    } catch (e) {
      result.loadFailed.push([sub, message(e)]);
    }
  }
  const wat2wasm = mods.get('./wat2wasm')?.['wat2wasm'] as Wat2Wasm | undefined;
  const wasmOpt = mods.get('./tools/wasm-opt')?.['wasmOpt'] as WasmOpt | undefined;
  if (!wat2wasm || !wasmOpt) throw new Error('./wat2wasm or ./tools/wasm-opt did not load');

  const smoke = await (await fetch('/smoke.wat')).text();
  const s = wat2wasm(smoke);
  result.smoke = s.binary ? await hex(s.binary) : `error: ${s.errors[0]?.message ?? '?'}`;

  const files = (await (await fetch('/corpus.json')).json()) as string[];
  const recipeInputs: [string, Uint8Array][] = [];
  for (const file of files) {
    const text = await (await fetch(`/corpus/${encodeURIComponent(file)}`)).text();
    const r: ModuleResult = { file, wat2wasm: '', opt: '', valid: false, optValid: false };
    let bin: Uint8Array | undefined;
    try {
      const w = wat2wasm(text);
      bin = w.binary;
      r.wat2wasm = bin ? await hex(bin) : `error: ${w.errors[0]?.message ?? '?'}`;
    } catch (e) {
      r.wat2wasm = `error: ${message(e)}`;
    }
    if (bin) {
      if (recipeInputs.length < RECIPE_MODULES) recipeInputs.push([file, bin.slice()]);
      r.valid = WebAssembly.validate(bin as BufferSource);
      try {
        // `validate: false`: the engine verdict is recorded separately, below.
        const out = await wasmOpt(bin, { optimizeLevel: 2, validate: false });
        if (typeof out === 'string') throw new Error('wasmOpt returned text');
        r.opt = await hex(out);
        r.optValid = WebAssembly.validate(out as BufferSource);
      } catch (e) {
        r.opt = `error: ${message(e)}`;
      }
    }
    result.modules.push(r);
  }
  result.recipe = await runRecipe(recipeInputs);
  return result;
}

const g = globalThis as { __result?: HarnessResult };
run().then(
  (r) => (g.__result = r),
  (e) => (g.__result = {
    userAgent: navigator.userAgent,
    loaded: [],
    loadFailed: [],
    smoke: '',
    modules: [],
    error: message(e),
  }),
);
