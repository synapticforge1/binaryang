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
 *   engine refusal is a browser difference, allowed only where listed.
 */

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
  error?: string;
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
