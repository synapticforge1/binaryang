// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module wabt-ts/compat
 *
 * Compatibility facade for code written against the upstream `npm:wabt`
 * (libwabt.js) package. Mirrors the async-factory shape that npm:wabt
 * exposes, mapped onto wabt-ts's underlying TypeScript pipeline.
 *
 * Migration from `npm:wabt`:
 *
 * ```ts
 * // before
 * import wabt from "wabt";
 *
 * // after — via Deno/Bun import map
 * // { "wabt": "jsr:@jrmarcum/wabt-ts/compat" }
 * import wabt from "wabt";
 *
 * // call shapes stay identical
 * const w = await wabt();
 * const m1 = w.parseWat(filename, src, { enable_all: true, exceptions: true });
 * const { buffer } = m1.toBinary({});
 * m1.destroy();
 *
 * const m2 = w.readWasm(bytes.buffer, { readDebugNames: true });
 * const wat = m2.toText({ foldExprs: false, inlineExport: false });
 * m2.destroy();
 * ```
 *
 * ## Coverage
 *
 * - `wabt()` — default export, returns a `Promise<WabtModule>` factory.
 *   wabt-ts itself is synchronous; the Promise is shape-matching only.
 * - `WabtModule.parseWat(filename, source, features?)` — throws on parse error.
 * - `WabtModule.readWasm(buffer, opts?)` — throws on decode error.
 * - `WasmModule.toBinary(opts)` → `{ buffer: ArrayBuffer }` — encodes the IR. **Throws** if the
 *   module cannot be encoded, which a module obtained from `readWasm` can be: decoding does not
 *   check index validity (that is the validator's job), so a corrupt-but-decodable binary yields a
 *   module that fails here rather than earlier.
 * - `WasmModule.toText(opts?)` → `string` — renders the IR as WAT.
 * - `WasmModule.applyNames()` — fills any unnamed entities with synthetic names.
 * - `WasmModule.destroy()` — releases the IR (a no-op aside from clearing the
 *   internal ref, since wabt-ts is GC'd; matches the libwabt.js contract).
 *
 * ## Error semantics
 *
 * The upstream `parseWat` / `readWasm` throw on failure. The compat layer
 * matches: if the underlying wabt-ts pipeline returns `Result.Error`, the
 * facade throws `new Error(formatErrors(errors))` with the same formatted
 * messages the CLI tools would print.
 *
 * ## What is NOT covered
 *
 * - The `wabt.WabtModule` JS proxy methods that are specific to the Emscripten
 *   build (heap views, manual ref counting beyond `destroy`).
 * - Spec-test parsing (no `parseWast` here — wabt-ts has `parseWastScript`
 *   on the main entry point if you need it directly).
 * - Anything binaryen-specific (use `@jrmarcum/binaryen-ts/compat` for those).
 */

import { formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import { LexerSource } from '../parser/lexer-source.ts';
import { parseWatModule } from '../parser/wast-parser.ts';
import { readBinaryIr } from '../reader/binary-reader.ts';
import { writeBinaryIr } from '../writer/binary-writer.ts';
import { writeWatModule } from '../writer/wat-writer.ts';
import { resolveNames } from '../ir/resolve-names.ts';
import { generateNames } from '../ir/generate-names.ts';
import { synthesizeTypes } from '../ir/synthesize-types.ts';
import type { Module as WabtIrModule } from '../ir/ir.ts';

// ---------------------------------------------------------------------------
// Public API shape — mirrors npm:wabt
// ---------------------------------------------------------------------------

/**
 * Feature flags accepted by `parseWat`. Mirrors the upstream `Features` flag
 * bag — any combination is permitted; unknown keys are ignored (matching
 * upstream's permissive behavior).
 *
 * The well-known keys are documented for editor autocomplete. Set
 * `enable_all: true` to opt into every proposal wabt-ts supports.
 */
export interface Features {
  /** Enable every supported proposal. Overrides individual flags below. */
  enable_all?: boolean;
  /** Exception-handling proposal (try / try_table / throw). */
  exceptions?: boolean;
  /** Threads + atomics proposal. */
  threads?: boolean;
  /** SIMD proposal (v128 + lane ops). */
  simd?: boolean;
  /** Reference types proposal. */
  reference_types?: boolean;
  /** Multi-value proposal. */
  multi_value?: boolean;
  /** Bulk memory proposal (memory.copy/fill/init, table.copy/init). */
  bulk_memory?: boolean;
  /** Tail-call proposal. */
  tail_call?: boolean;
  /** GC proposal (struct / array / i31 — see wabt-ts CLAUDE.md for coverage). */
  gc?: boolean;
  /** Memory64 proposal. */
  memory64?: boolean;
  /** Multi-memory proposal. */
  multi_memory?: boolean;
  /** Custom-page-sizes proposal. */
  custom_page_sizes?: boolean;
  /** Any other proposal flag — passed through for shape compatibility. */
  [k: string]: boolean | undefined;
}

/** Options accepted by `readWasm`. */
export interface ReadWasmOptions {
  /** Read the optional `name` custom section. Default: true (matching upstream). */
  readDebugNames?: boolean;
}

/** Options accepted by `toText`. */
export interface ToTextOptions {
  /** Currently a no-op — wabt-ts emits linear-form WAT regardless. Accepted for shape compatibility. */
  foldExprs?: boolean;
  /** Emit `(export "..." (...))` inline inside the defining item. Default: true. */
  inlineExport?: boolean;
}

/** Options accepted by `toBinary` (currently unused but accepted for shape compatibility). */
export interface ToBinaryOptions {
  /** Generate sourcemap output. Not yet supported; accepted but ignored. */
  log?: boolean;
  /** Generate write_debug_names entries. Not yet supported; accepted but ignored. */
  write_debug_names?: boolean;
  /** Any other option — passed through for shape compatibility. */
  [k: string]: unknown;
}

/**
 * Compat-facing module handle returned by `parseWat` / `readWasm`. Wraps the
 * underlying wabt-ts IR and provides the libwabt.js-shaped methods.
 */
export interface WasmModule {
  /** Encode the IR as a wasm binary, returning `{ buffer }` to match upstream's shape. */
  toBinary(opts?: ToBinaryOptions): { buffer: ArrayBuffer; log?: string };
  /** Render the IR as a WAT text module. */
  toText(opts?: ToTextOptions): string;
  /** Fill any unnamed funcs / globals / etc. with synthetic names (matches upstream). */
  applyNames(): void;
  /** Release the IR reference. After this, all other methods throw. */
  destroy(): void;
}

/** The factory return value — equivalent to upstream's `WabtModule`. */
export interface WabtModule {
  /**
   * Parse a WAT source string into a module handle.
   *
   * @throws On any parse error, with the formatted error list as the message.
   */
  parseWat(filename: string, source: string | Uint8Array, features?: Features): WasmModule;

  /**
   * Decode a wasm binary into a module handle.
   *
   * @throws On any decode error, with the formatted error list as the message.
   */
  readWasm(buffer: ArrayBuffer | Uint8Array, opts?: ReadWasmOptions): WasmModule;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function makeWasmModuleHandle(ir: WabtIrModule | null): WasmModule {
  // Captured-by-closure ref; destroy() nulls it out and the other methods
  // throw on null. Matches the libwabt.js destroy() semantics where the
  // wasm-side allocation is freed and further calls are undefined behavior.
  let module: WabtIrModule | null = ir;

  function checkAlive(method: string): WabtIrModule {
    if (module === null) {
      throw new Error(`wabt-ts/compat: ${method}() called on a destroyed WasmModule`);
    }
    return module;
  }

  return {
    toBinary(_opts: ToBinaryOptions = {}): { buffer: ArrayBuffer; log?: string } {
      const m = checkAlive('toBinary');
      // The binary writer is deliberately FAIL-LOUD (T10.7) and must stay so —
      // it refuses to emit bytes it cannot justify. But its raw message is an
      // internal diagnostic, and `parseWat` / `readWasm` both surface failures
      // as `new Error(formatErrors(...))`. This one propagated the writer's own
      // string, so the same API threw two different SHAPES of error depending
      // on which method failed (T13.30).
      //
      // Reachable without any bug on the caller's part: a module can decode
      // cleanly and still be un-encodable, because index validity is the
      // VALIDATOR's job and not the reader's — `readWasm` of a corrupted binary
      // whose func references a type the type section no longer holds returns a
      // module, and this is where it fails.
      let bytes: Uint8Array;
      try {
        bytes = writeBinaryIr(m);
      } catch (e) {
        throw new Error(
          `toBinary: the module could not be encoded: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      // Match upstream's `{ buffer }` shape. Copy into a fresh ArrayBuffer
      // so the caller can read `result.buffer` as a standalone ArrayBuffer
      // (Uint8Array.buffer can be a SharedArrayBuffer or shared between
      // multiple views; an explicit copy avoids accidental aliasing).
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return { buffer };
    },

    toText(opts: ToTextOptions = {}): string {
      const m = checkAlive('toText');
      // `foldExprs` is accepted for shape compatibility; wabt-ts's writer
      // emits linear form regardless. `inlineExport` is honored.
      return writeWatModule(m, {
        inlineExport: opts.inlineExport !== false,
      });
    },

    applyNames(): void {
      const m = checkAlive('applyNames');
      generateNames(m);
    },

    destroy(): void {
      module = null;
    },
  };
}

/**
 * Default export — matches the upstream `npm:wabt()` factory.
 *
 * wabt-ts itself is synchronous (no WebAssembly module to instantiate); the
 * Promise is shape-matching only. Callers can either `await wabt()` or
 * `wabt().then(w => ...)` identically to upstream.
 */
export default function wabt(): Promise<WabtModule> {
  const api: WabtModule = {
    parseWat(filename: string, source: string | Uint8Array, _features?: Features): WasmModule {
      // wabt-ts already understands every proposal it implements; the
      // Features flag bag is accepted for shape parity but the parser does
      // not gate on it. Future per-proposal validation can read this object.
      const src = new LexerSource(source, filename);
      const { module, errors } = parseWatModule(src);
      if (hasErrors(errors)) {
        throw new Error(formatErrors(errors));
      }
      // Match the wat2wasm pipeline: resolve names + synthesize type
      // entries so toBinary() emits a valid binary by default.
      resolveNames(module, errors);
      if (hasErrors(errors)) {
        throw new Error(formatErrors(errors));
      }
      synthesizeTypes(module);
      return makeWasmModuleHandle(module);
    },

    readWasm(buffer: ArrayBuffer | Uint8Array, opts: ReadWasmOptions = {}): WasmModule {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const errors = makeErrorList();
      const module = readBinaryIr(bytes, errors, {
        readDebugNames: opts.readDebugNames !== false,
      });
      if (hasErrors(errors)) {
        throw new Error(formatErrors(errors));
      }
      return makeWasmModuleHandle(module);
    },
  };
  return Promise.resolve(api);
}
