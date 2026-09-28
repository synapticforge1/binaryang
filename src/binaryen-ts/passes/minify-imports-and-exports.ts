/**
 * @module binaryen-ts/passes/minify-imports-and-exports
 *
 * `MinifyImports`, `MinifyImportsAndExports`, `MinifyImportsAndExportsAndModules`
 * — upstream binaryen's passes of the same names (`--minify-imports`, …):
 * rename the INTERFACE strings to the shortest names there are, and hand back
 * the old → new map the HOST must apply.
 *
 * Why only the interface (cmem/names.md § 1a, measured 2026-09-28): every
 * reference inside a binary is an INDEX, so internal names cost no bytes at
 * `-Oz` and renaming them collects nothing. The whole prize is the import
 * `module` / `field` and export strings — at most 29,668 bytes, 3.24%, over
 * the corpus — and it is a CONTRACT change: a renamed export or import is
 * correct only when every host is updated from the map. So these passes are
 * OPT-IN, never in an `-O` list (owner: an exported name must be preserved,
 * "or we have name mangling"), and they always produce the map.
 *
 * Upstream's behaviour, measured against `wasm-opt` 132 (2026-09-28) and
 * matched here name for name:
 * - one name sequence, imports first, then exports: `a`…`z`, `A`…`Z`, `_`,
 *   `$`, then `aa`, `ba`, … (later characters add `0`–`9`), skipping the JS
 *   reserved words of up to four letters, and `env`;
 * - imports named in kind order — memories, tables, globals, functions, tags
 *   — each (module, field) pair once: two imports of the same pair share a name;
 * - without `…AndModules`, only imports from `env` or a `wasi_*` module are
 *   renamed; with it, every import is, and every module becomes `a`;
 * - the map lists each side sorted by NEW name.
 *
 * @license MIT
 */

import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import type { WasmModule } from '../ir/module.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

/** The old → new names a host must apply. Upstream's JSON, as data. */
export interface MinifyMap {
  /** `[module, field, newField]` — `module` is the ORIGINAL module name. */
  imports: [module: string, field: string, newField: string][];
  /** `[oldName, newName]`. */
  exports: [oldName: string, newName: string][];
  /** The module every import now names, when modules were minified too. */
  module?: string;
}

/** Which interface strings to rename. */
export interface MinifyOptions {
  /** Export names too. */
  exports: boolean;
  /** Every import, and every module becomes {@link MINIFIED_MODULE}. */
  modules: boolean;
}

/** The module name every import gets under `…AndModules` — upstream's. */
export const MINIFIED_MODULE = 'a';

const INITIAL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const LATER = INITIAL + '0123456789';
/** JS reserved words of up to four letters, and `env` — upstream's list. */
const RESERVED = new Set([
  'do',
  'if',
  'in',
  'for',
  'new',
  'try',
  'var',
  'env',
  'let',
  'case',
  'else',
  'enum',
  'void',
  'this',
  'with',
]);

/** Upstream's `MinifiedNameGenerator`: the n-th name, reserved words skipped. */
class NameGenerator {
  private state = 0;
  next(): string {
    for (;;) {
      let n = this.state++;
      let s = INITIAL[n % INITIAL.length]!;
      n = Math.floor(n / INITIAL.length);
      while (n) {
        s += LATER[(n - 1) % LATER.length];
        n = Math.floor((n - 1) / LATER.length);
      }
      if (!RESERVED.has(s)) return s;
    }
  }
}

const IMPORT_KIND_ORDER = [
  ExternalKind.Memory,
  ExternalKind.Table,
  ExternalKind.Global,
  ExternalKind.Func,
  ExternalKind.Tag,
];

/**
 * Rename `module`'s interface strings in place and return the map. Only the
 * strings change: every reference is an index, so nothing else moves.
 */
export function minifyImportsAndExports(module: WasmModule, opts: MinifyOptions): MinifyMap {
  const names = new NameGenerator();
  const imports = new Map<string, [string, string, string]>(); // key → [module, field, new]
  const minifiable = (mod: string) => opts.modules || mod === 'env' || mod.startsWith('wasi_');
  for (const kind of IMPORT_KIND_ORDER) {
    for (const imp of module.imports) {
      if (imp.kind !== kind || !minifiable(imp.module)) continue;
      const key = JSON.stringify([imp.module, imp.field]);
      let entry = imports.get(key);
      if (entry === undefined) {
        entry = [imp.module, imp.field, names.next()];
        imports.set(key, entry);
      }
      imp.field = entry[2];
      if (opts.modules) imp.module = MINIFIED_MODULE;
    }
  }
  const exports: [string, string][] = [];
  if (opts.exports) {
    for (const exp of module.exports) {
      const now = names.next();
      exports.push([exp.name, now]);
      exp.name = now;
    }
  }
  const byNew = <T extends string[]>(a: T, b: T) => {
    const x = a[a.length - 1]!, y = b[b.length - 1]!;
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const map: MinifyMap = {
    imports: [...imports.values()].sort(byNew),
    exports: exports.sort(byNew),
  };
  if (opts.modules) map.module = MINIFIED_MODULE;
  return map;
}

/**
 * `map` as upstream prints it — a JSON object with an `imports` list of
 * `[module, field, new]` and an `exports` list of `[old, new]`.
 */
export function formatMinifyMap(map: MinifyMap): string {
  const row = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;
  const list = (rows: string[][], pad: string) =>
    rows.length === 0 ? '' : rows.map((r) => `${pad}${row(r)}`).join(',\n') + '\n';
  return `{\n "imports": [\n${list(map.imports, '  ')} ],\n"exports": [\n${
    list(map.exports, '  ')
  } ]\n}\n`;
}

// ---------------------------------------------------------------------------
// The map a pass run produced
// ---------------------------------------------------------------------------

const maps = new WeakMap<WasmModule, MinifyMap>();

/**
 * The map the minify passes produced for `module` since it was last taken,
 * and forget it — `undefined` if none ran. Two runs COMPOSE (a second run
 * renames names the first made; the map still starts from the originals), so
 * `wasm-opt --converge` hands the host one map.
 */
export function takeMinifyMap(module: WasmModule): MinifyMap | undefined {
  const m = maps.get(module);
  maps.delete(module);
  return m;
}

function record(module: WasmModule, next: MinifyMap): void {
  const prev = maps.get(module);
  if (prev === undefined) {
    maps.set(module, next);
    return;
  }
  // prev: original → mid; next: mid → new. The host holds the ORIGINALS.
  const importNew = new Map(next.imports.map(([m, f, n]) => [JSON.stringify([m, f]), n]));
  const midModule = prev.module;
  const imports = prev.imports.map(([m, f, mid]): [string, string, string] => {
    const n = importNew.get(JSON.stringify([midModule ?? m, mid]));
    return [m, f, n ?? mid];
  });
  const mids = new Set(prev.imports.map(([m, , mid]) => JSON.stringify([midModule ?? m, mid])));
  for (const [m, f, n] of next.imports) {
    if (!mids.has(JSON.stringify([m, f]))) imports.push([m, f, n]); // first renamed now
  }
  const exportNew = new Map(next.exports);
  const exports = prev.exports.map(([o, mid]): [string, string] => [o, exportNew.get(mid) ?? mid]);
  const midExports = new Set(prev.exports.map(([, mid]) => mid));
  for (const [o, n] of next.exports) if (!midExports.has(o)) exports.push([o, n]);
  const composed: MinifyMap = { imports, exports };
  const mod = next.module ?? prev.module;
  if (mod !== undefined) composed.module = mod;
  maps.set(module, composed);
}

abstract class MinifyPass implements Pass {
  abstract readonly name: string;
  abstract readonly description: string;
  protected abstract readonly opts: MinifyOptions;
  readonly requiresNonNullableLocalFixups = false;
  run(module: WasmModule, _options: PassOptions): void {
    record(module, minifyImportsAndExports(module, this.opts));
  }
}

/** Upstream `--minify-imports`: `env` / `wasi_*` import fields only. */
export class MinifyImportsPass extends MinifyPass {
  readonly name = 'MinifyImports';
  readonly description = 'minifies import names (only those, and not export names)';
  protected readonly opts = { exports: false, modules: false };
}

/** Upstream `--minify-imports-and-exports`. */
export class MinifyImportsAndExportsPass extends MinifyPass {
  readonly name = 'MinifyImportsAndExports';
  readonly description =
    'minifies both import and export names, and emits a mapping to the minified ones';
  protected readonly opts = { exports: true, modules: false };
}

/** Upstream `--minify-imports-and-exports-and-modules`. */
export class MinifyImportsAndExportsAndModulesPass extends MinifyPass {
  readonly name = 'MinifyImportsAndExportsAndModules';
  readonly description =
    'minifies both import and export names, and emits a mapping to the minified ones, and minifies the modules as well';
  protected readonly opts = { exports: true, modules: true };
}

registerPass(MinifyImportsPass);
registerPass(MinifyImportsAndExportsPass);
registerPass(MinifyImportsAndExportsAndModulesPass);
