// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module compat/wabt-compat
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
 * // { "wabt": "jsr:@jrmarcum/binaryang/compat/wabt" }
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
 * - `WasmModule.validate()` — throws on an invalid module (the features it was parsed with;
 *   every feature for one from `readWasm`).
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
 * - Anything binaryen-specific (use `@jrmarcum/binaryang/compat/binaryen` for those).
 */

import { type ErrorList, formatErrors, hasErrors, makeErrorList } from '../core/error.ts';
import { LexerSource } from '../parser/lexer-source.ts';
import { parseWatModule } from '../parser/wast-parser.ts';
import { readBinaryIr } from '../reader/binary-reader.ts';
import { writeBinaryIr } from '../writer/binary-writer.ts';
import { writeWatModule } from '../writer/wat-writer.ts';
import { resolveNames } from '../ir/resolve-names.ts';
import { generateNames } from '../ir/generate-names.ts';
import { synthesizeTypes } from '../ir/synthesize-types.ts';
import type { Module as WabtIrModule } from '../ir/ir.ts';
import { allFeatures, defaultFeatures, type Features } from '../core/feature.ts';
import { validateModule } from '../validator/validator.ts';
import { FEATURE_DEFINITIONS } from '../definitions/mod.ts';

/**
 * libwabt.js's feature-bag key for each of binaryang's features: D2's CLI spelling with `_` for
 * `-` (`bulk-memory` → `bulk_memory`), and libwabt's own `sat_float_to_int` beside upstream's CLI
 * `saturating-float-to-int`.
 */
const FEATURE_KEYS = new Map<string, keyof Features>([
  ...FEATURE_DEFINITIONS.entries.map((f) =>
    [f.cli.replaceAll('-', '_'), f.name as keyof Features] as const
  ),
  ['sat_float_to_int', 'satFloatToInt'],
]);

/**
 * The features a libwabt.js feature bag asks for: upstream's defaults, each key given set on or
 * off, everything with `enable_all`. Unknown keys are ignored, as upstream ignores them.
 */
function featuresOf(bag: WabtFeatures | undefined): Features {
  if (bag?.enable_all === true) return allFeatures();
  const features = defaultFeatures();
  for (const [key, on] of Object.entries(bag ?? {})) {
    const name = FEATURE_KEYS.get(key);
    if (name !== undefined && on !== undefined) features[name] = on;
  }
  return features;
}

/**
 * The validation errors `module` has ONLY because some feature is off in `features` — those the
 * all-features run does not report. That is what libwabt.js's parser refuses (it gates each
 * construct on its feature while parsing), with nothing else of validation: `parseWat` does not
 * validate (DG5), it refuses a disabled feature.
 */
function disabledFeatureErrors(module: WabtIrModule, features: Features): ErrorList {
  const all = makeErrorList();
  validateModule(module, all, { features: allFeatures() });
  const seen = new Set(
    all.map((e) => `${e.loc.offset}:${e.loc.line}:${e.loc.column}:${e.message}`),
  );
  const gated = makeErrorList();
  validateModule(module, gated, { features });
  return gated.filter((e) =>
    !seen.has(`${e.loc.offset}:${e.loc.line}:${e.loc.column}:${e.message}`)
  );
}

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
export interface WabtFeatures {
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
  /**
   * Read the optional `name` custom section. Default: true — binaryang's decision (names.md § 4);
   * libwabt.js's default is false.
   */
  readDebugNames?: boolean;
}

/** Options accepted by `toText`. */
export interface ToTextOptions {
  /**
   * Fold the instructions into s-expressions. Default: true (folded, this writer's default since
   * 1.5.4; libwabt.js's default is false). `false` writes linear WAT. 🔧 It was ignored, and its
   * doc said the output was linear regardless — the output was folded (code lens pass 3).
   */
  foldExprs?: boolean;
  /** Emit `(export "..." (...))` inline inside the defining item. Default: true (libwabt.js: false). */
  inlineExport?: boolean;
}

/** Options accepted by `toBinary` (currently unused but accepted for shape compatibility). */
export interface ToBinaryOptions {
  /** Generate sourcemap output. Not yet supported; accepted but ignored. */
  log?: boolean;
  /**
   * Accepted for shape compatibility and IGNORED: the name section is ALWAYS
   * written, `false` included — wabt-ts keeps names (N1, cmem/names.md), where
   * libwabt.js writes them only on `true`. To remove names, use `wasmStrip`.
   */
  write_debug_names?: boolean;
  /** Any other option — passed through for shape compatibility. */
  [k: string]: unknown;
}

/**
 * Compat-facing module handle returned by `parseWat` / `readWasm`. Wraps the
 * underlying wabt-ts IR and provides the libwabt.js-shaped methods.
 */
export interface WabtWasmModule {
  /** Encode the IR as a wasm binary, returning `{ buffer }` to match upstream's shape. */
  toBinary(opts?: ToBinaryOptions): { buffer: ArrayBuffer; log?: string };
  /** Render the IR as a WAT text module. */
  toText(opts?: ToTextOptions): string;
  /** Fill any unnamed funcs / globals / etc. with synthetic names (matches upstream). */
  applyNames(): void;
  /**
   * Validate the module with the features it was parsed or read with; THROWS on an invalid one,
   * as libwabt.js's `validate()` (an `Error` naming this method). It was missing: code ported
   * from libwabt.js got a TypeError (open-work 52 (b), divergence CL21, 2026-10-28).
   */
  validate(): void;
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
  parseWat(filename: string, source: string | Uint8Array, features?: WabtFeatures): WabtWasmModule;

  /**
   * Decode a wasm binary into a module handle.
   *
   * @throws On any decode error, with the formatted error list as the message.
   */
  readWasm(buffer: ArrayBuffer | Uint8Array, opts?: ReadWasmOptions): WabtWasmModule;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function makeWasmModuleHandle(ir: WabtIrModule | null, features: Features): WabtWasmModule {
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
      // `log` is always there, as libwabt.js's (a string; this writer keeps no log, so empty).
      // It was absent (open-work 52 (b), CL21).
      return { buffer, log: '' };
    },

    validate(): void {
      const m = checkAlive('validate');
      const errors = makeErrorList();
      validateModule(m, errors, { features });
      if (hasErrors(errors)) throw new Error(`validate: ${formatErrors(errors)}`);
    },

    toText(opts: ToTextOptions = {}): string {
      const m = checkAlive('toText');
      // Both options honoured; each defaults to true (see `ToTextOptions`). NAMING a form asks
      // for it everywhere, as wasm2wat's `--fold` / `--linear`: as-written (S7) only when
      // `foldExprs` is not given.
      return writeWatModule(m, {
        inlineExport: opts.inlineExport !== false,
        fold: opts.foldExprs !== false,
        asWritten: opts.foldExprs === undefined,
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
    parseWat(
      filename: string,
      source: string | Uint8Array,
      featureBag?: WabtFeatures,
    ): WabtWasmModule {
      // The feature bag GATES, as libwabt.js's: a construct of a feature that is off is refused
      // here (see `disabledFeatureErrors`). 🔧 It was accepted and ignored, so a partial bag
      // equalled `enable_all` (open-work 52 (b), divergence CL24, 2026-10-28).
      const features = featuresOf(featureBag);
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
      const gated = disabledFeatureErrors(module, features);
      if (hasErrors(gated)) throw new Error(formatErrors(gated));
      return makeWasmModuleHandle(module, features);
    },

    readWasm(buffer: ArrayBuffer | Uint8Array, opts: ReadWasmOptions = {}): WabtWasmModule {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const errors = makeErrorList();
      const module = readBinaryIr(bytes, errors, {
        readDebugNames: opts.readDebugNames !== false,
      });
      if (hasErrors(errors)) {
        throw new Error(formatErrors(errors));
      }
      // Read with every feature, as before, and validated (on request) with every feature: a
      // binary's bag is not gated here — wasmtk reads its own GC / EH output this way, passing
      // only `readDebugNames`, and no record asks for it (CL24 is `parseWat`'s).
      return makeWasmModuleHandle(module, allFeatures());
    },
  };
  return Promise.resolve(api);
}
