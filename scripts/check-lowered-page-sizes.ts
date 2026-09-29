// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * `proposals/custom-page-sizes`' BEHAVIOUR, on V8 — through
 * `LowerCustomPageSizes`.
 *
 * V8 has no custom-page-sizes support, so the original module cannot run and
 * the differential of `check-spec-behaviour.ts` has no oracle. The oracle here
 * is the spec's own expected values, as in `check-translate-eh.ts`. Each module
 * runs in V8 in several WORLDS, each with its own registered instances so an
 * import chain stays within one world:
 *
 * | world | the module |
 * | ----- | ---------- |
 * | `lowered` | lowered as read |
 * | `round trip` | read, written, read, lowered |
 * | `-O1` … `-Oz` | optimized at that level (custom pages and all), then lowered |
 *
 * So one run judges both the lowering (the first world) and our optimizer on
 * custom-page memories (the rest), with the spec's authors as the authority.
 *
 * Every `module` must instantiate; every `assert_return` / `assert_trap` must
 * hold in every world; every lowered module must validate with no custom page
 * size left. Exit 0 only then.
 *
 * Usage: `deno run --allow-read scripts/check-lowered-page-sizes.ts <prepared proposals/custom-page-sizes dir>`
 * (`deno task proposals` runs it).
 */

import { readForPasses } from '../src/binaryen-ts/ir/prepare.ts';
import { writeWasm } from '../src/binaryen-ts/ir/write-wasm.ts';
import { PassRunner } from '../src/binaryen-ts/passes/index.ts';
import { hasErrors } from '../src/wabt-ts/core/error.ts';
import { allFeatures } from '../src/wabt-ts/core/feature.ts';
import { wasmValidate } from '../src/wabt-ts/tools/wasm-validate.ts';

const dir = Deno.args[0];
if (!dir) {
  console.error('usage: check-lowered-page-sizes.ts <prepared custom-page-sizes dir>');
  Deno.exit(2);
}

interface SpecValue {
  type: string;
  value?: string;
}
interface Action {
  type: string;
  module?: string;
  field: string;
  args: SpecValue[];
}
interface Command {
  type: string;
  line: number;
  filename?: string;
  module_type?: string;
  name?: string;
  as?: string;
  action?: Action;
  expected?: SpecValue[];
}

const LEVELS: [string, 0 | 1 | 2 | 3, 0 | 1 | 2][] = [
  ['-O1', 1, 0],
  ['-O2', 2, 0],
  ['-O3', 3, 0],
  ['-Os', 2, 1],
  ['-Oz', 2, 2],
];

function lower(bytes: Uint8Array, level?: [0 | 1 | 2 | 3, 0 | 1 | 2]): Uint8Array {
  const m = readForPasses(bytes);
  if (level !== undefined) {
    new PassRunner(m, { optimizeLevel: level[0], shrinkLevel: level[1] })
      .addDefaultOptimizationPasses().run();
  }
  new PassRunner(m, {}).add('LowerCustomPageSizes').run();
  return writeWasm(m);
}

const WORLDS: [string, (b: Uint8Array) => Uint8Array][] = [
  ['lowered', (b) => lower(b)],
  ['round trip', (b) => lower(writeWasm(readForPasses(b)))],
  ...LEVELS.map(([n, o, s]) =>
    [n, (b: Uint8Array) => lower(b, [o, s])] as [
      string,
      (b: Uint8Array) => Uint8Array,
    ]
  ),
];

/** The testsuite's `spectest` module, as `spec/interpreter` defines it. */
const SPECTEST: Record<string, unknown> = {
  global_i32: new WebAssembly.Global({ value: 'i32', mutable: false }, 666),
  global_i64: new WebAssembly.Global({ value: 'i64', mutable: false }, 666n),
  global_f32: new WebAssembly.Global({ value: 'f32', mutable: false }, 666.6),
  global_f64: new WebAssembly.Global({ value: 'f64', mutable: false }, 666.6),
  table: new WebAssembly.Table({ initial: 10, maximum: 20, element: 'anyfunc' }),
  memory: new WebAssembly.Memory({ initial: 1, maximum: 2 }),
  print: () => {},
  print_i32: () => {},
  print_i64: () => {},
  print_f32: () => {},
  print_f64: () => {},
  print_i32_f32: () => {},
  print_f64_f64: () => {},
};

function toJs(v: SpecValue): number | bigint {
  const s = v.value ?? '0';
  switch (v.type) {
    case 'i32':
      return Number(BigInt.asIntN(32, BigInt(s)));
    case 'i64':
      return BigInt.asIntN(64, BigInt(s));
    case 'f32': {
      const d = new DataView(new ArrayBuffer(4));
      d.setUint32(0, Number(s));
      return d.getFloat32(0);
    }
    default: {
      const d = new DataView(new ArrayBuffer(8));
      d.setBigUint64(0, BigInt(s));
      return d.getFloat64(0);
    }
  }
}

function same(got: unknown, want: SpecValue): boolean {
  if (want.value?.startsWith('nan:')) return typeof got === 'number' && Number.isNaN(got);
  const w = toJs(want);
  if (typeof w === 'bigint') return got === w;
  return Object.is(got, w) || (got === w && w !== 0);
}

interface World {
  name: string;
  make: (b: Uint8Array) => Uint8Array;
  current?: WebAssembly.Exports | undefined;
  named: Map<string, WebAssembly.Exports>;
  registered: Map<string, WebAssembly.Exports>;
}

let assertions = 0;
let modules = 0;
/**
 * `assert_unlinkable`s that LINK once lowered, pinned by name — a ratchet, as
 * `REFUSED_BUDGET`: a new one fails, and so does a pin that stops linking.
 *
 * EMPTY since P1 closed (owner, 2026-09-29). `:104` — a native 64 KiB-page
 * importer of a lowered 1-byte-page memory — linked while the lowered memory
 * kept its export name, and could read past the logical size without a trap.
 * The memory is exported as `<name>#pagesize=1` now, so that link fails as the
 * proposal says; this ratchet is what asked for the pin to go. `:111` — a
 * lowered importer of a native 64 KiB memory — fails too: no such name.
 */
const LINKS_ANYWAY = new Set<string>();
const linksAnyway = new Set<string>();
let unlinkable = 0;
/** Modules V8's own caps refuse; our validator accepted their lowered bytes. */
const engineLimited = new Set<string>();
const failures: string[] = [];
const fail = (w: World, where: string, why: string) => failures.push(`${where} [${w.name}] ${why}`);

const dirs = [...Deno.readDirSync(dir)].filter((e) => e.isDirectory).map((e) => e.name).sort();
for (const d of dirs) {
  let manifest: { commands: Command[] };
  try {
    manifest = JSON.parse(Deno.readTextFileSync(`${dir}/${d}/${d}.json`));
  } catch {
    continue;
  }
  const worlds: World[] = WORLDS.map(([name, make]) => ({
    name,
    make,
    named: new Map(),
    registered: new Map(),
  }));
  for (const c of manifest.commands) {
    const where = `${d}.wast:${c.line}`;
    if ((c.type === 'module' || c.type === 'module_definition') && c.filename?.endsWith('.wasm')) {
      modules++;
      const bytes = Deno.readFileSync(`${dir}/${d}/${c.filename}`);
      for (const w of worlds) {
        let made: Uint8Array;
        try {
          made = w.make(bytes);
        } catch (e) {
          fail(w, where, `our pipeline threw: ${(e as Error).message.split('\n')[0]}`);
          w.current = undefined;
          continue;
        }
        let mod: WebAssembly.Module;
        try {
          mod = new WebAssembly.Module(made as BufferSource);
        } catch (e) {
          const msg = (e as Error).message;
          // V8's OWN caps (memory64: 262,144 pages) refuse modules the spec
          // calls valid — even the default-page-size ones in
          // `memory_max_i64.wast`, which this pass does not touch. For those,
          // our validator judges the lowered bytes instead: the lowering must
          // still produce a VALID module, whether or not V8 can hold it.
          if (/implementation limit/.test(msg)) {
            const { errors } = wasmValidate(made, { features: allFeatures() });
            if (hasErrors(errors)) {
              fail(w, where, `INVALID after lowering (our validator): ${errors[0]!.message}`);
            } else {
              engineLimited.add(where);
            }
          } else {
            fail(w, where, `INVALID after lowering: ${msg.slice(0, 140)}`);
          }
          w.current = undefined;
          continue;
        }
        if (c.type === 'module_definition') continue; // compiled, not instantiated
        const imports: Record<string, Record<string, unknown>> = {};
        for (const imp of WebAssembly.Module.imports(mod)) {
          const from = imp.module === 'spectest' ? SPECTEST : w.registered.get(imp.module);
          (imports[imp.module] ??= {})[imp.name] = from?.[imp.name];
        }
        try {
          const inst = new WebAssembly.Instance(mod, imports as WebAssembly.Imports);
          w.current = inst.exports;
          if (c.name !== undefined) w.named.set(c.name, inst.exports);
        } catch (e) {
          fail(w, where, `does not instantiate: ${(e as Error).message.slice(0, 140)}`);
          w.current = undefined;
        }
      }
      continue;
    }
    if (c.type === 'assert_unlinkable' && c.filename?.endsWith('.wasm')) {
      unlinkable++;
      const bytes = Deno.readFileSync(`${dir}/${d}/${c.filename}`);
      for (const w of worlds) {
        let linked = false;
        try {
          const mod = new WebAssembly.Module(w.make(bytes) as BufferSource);
          const imports: Record<string, Record<string, unknown>> = {};
          for (const imp of WebAssembly.Module.imports(mod)) {
            (imports[imp.module] ??= {})[imp.name] = w.registered.get(imp.module)?.[imp.name];
          }
          new WebAssembly.Instance(mod, imports as WebAssembly.Imports);
          linked = true;
        } catch {
          // refused to link: what the spec asks
        }
        if (linked && !LINKS_ANYWAY.has(where)) {
          fail(w, where, 'LINKED; the spec says it is unlinkable');
        }
        if (linked && LINKS_ANYWAY.has(where)) linksAnyway.add(where);
      }
      continue;
    }
    if (c.type === 'register') {
      for (const w of worlds) {
        const exp = c.name !== undefined ? w.named.get(c.name) : w.current;
        if (exp !== undefined && c.as !== undefined) w.registered.set(c.as, exp);
      }
      continue;
    }
    const a = c.action;
    if (a?.type !== 'invoke') continue;
    if (c.type !== 'assert_return' && c.type !== 'assert_trap' && c.type !== 'action') continue;
    assertions++;
    for (const w of worlds) {
      const exp = a.module !== undefined ? w.named.get(a.module) : w.current;
      const f = exp?.[a.field];
      if (typeof f !== 'function') {
        fail(w, where, `no export ${a.field}`);
        continue;
      }
      let got: unknown;
      try {
        got = (f as (...x: unknown[]) => unknown)(...a.args.map(toJs));
      } catch (e) {
        if (c.type === 'assert_trap' && e instanceof WebAssembly.RuntimeError) continue;
        fail(w, where, `${a.field} threw ${(e as Error).message}`);
        continue;
      }
      if (c.type === 'assert_trap') {
        fail(w, where, `${a.field} returned; the spec says it traps`);
        continue;
      }
      const want = c.expected ?? [];
      const gotList = want.length > 1 ? (got as unknown[]) : want.length === 1 ? [got] : [];
      if (want.length === 0 && got !== undefined) fail(w, where, `${a.field} returned a value`);
      want.forEach((v, i) => {
        if (!same(gotList[i], v)) {
          fail(w, where, `${a.field}: want ${v.type} ${v.value} got ${String(gotList[i])}`);
        }
      });
    }
  }
}

console.log(
  `  === proposals/custom-page-sizes on V8, through LowerCustomPageSizes (${WORLDS.length} worlds) ===`,
);
console.log(
  `    modules        ${String(modules).padStart(5)}   (each lowered in every world, V8-compiled)`,
);
console.log(`    assertions     ${String(assertions).padStart(5)}   (each checked in every world)`);
console.log(
  `    V8 caps        ${
    String(engineLimited.size).padStart(5)
  }   (V8 refuses the size; our validator accepts the lowered bytes)`,
);
console.log(
  `    unlinkable     ${
    String(unlinkable).padStart(5)
  }   (must fail to link in every world; ${linksAnyway.size} pinned as linking anyway — P1)`,
);
for (const p of LINKS_ANYWAY) {
  if (!linksAnyway.has(p)) {
    failures.push(`${p} is pinned in LINKS_ANYWAY but no longer links — remove the pin`);
  }
}
console.log(`    failures       ${String(failures.length).padStart(5)}`);
for (const f of failures.slice(0, 30)) console.log(`      ${f}`);
if (failures.length === 0) {
  console.log(
    `\n  TOTAL — every module compiles and instantiates, and all ${assertions} assertions hold in every world.`,
  );
}
Deno.exit(failures.length === 0 ? 0 : 1);
