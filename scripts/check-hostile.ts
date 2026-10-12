// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Open-work 13, the hardening round: the two instruments of its pass 1, kept so
 * every later pass re-runs them (the round repeats until a pass finds nothing).
 *
 * The contract they check: given hostile or malformed input, every entry point
 * either works or answers in its OWN typed way — a reader's `WasmBinaryError`,
 * a writer's `WasmEncodeError`, a tool's error list, the interpreter's `Stop`
 * or `Trap`, the bundler's `BundleError` — and never lets a bare JavaScript
 * error escape, or runs away.
 *
 * 1. **Depth** — valid modules nesting 500 … 100,000 blocks, through every
 *    stage. Reports any raw error (a contract break) and, per stage, whether it
 *    WORKED or refused as too deep (the capability ceiling, not a break).
 * 2. **Mutation fuzz** — every `stride`-th `.wasm` under a corpus folder,
 *    truncated at 12 points and corrupted at 24 bytes, through the reader, the
 *    optimizer + writer, the interpreter, the bundler and `compat/binaryen`.
 *    Classes: ok | typed | UNTYPED | SLOW (> 5 s).
 *
 * Reported, not gated. Exit 1 when anything UNTYPED or SLOW is seen.
 *
 * ```sh
 * bun run hostile <corpus dir of .wasm files> [stride=7]
 * ```
 *
 * Pass 1 (2026-10-09), on wasmtk's `tests/wasi/wasm_wasi` (61 modules, 2,145
 * mutants): UNTYPED 287 → 0. The optimizer stage reads as `wasm-opt` does, validated first:
 * the passes' contract is a valid module (handed an invalid one, one pass fails in its own
 * words). See cmem/hardening.md.
 */

import { readForPasses, readValidForPasses, WasmBinaryError } from '../src/ir/prepare.ts';
import { WasmEncodeError, writeWasm, writeWat } from '../src/ir/write-wasm.ts';
import { wat2wasm } from '../src/tools/wat2wasm.ts';
import { wasm2wat } from '../src/tools/wasm2wat.ts';
import { wasmValidate } from '../src/tools/wasm-validate.ts';
import { PassRunner } from '../src/passes/index.ts';
import { interpModule } from '../src/tools/wasm-interp.ts';
import { Stop, Trap } from '../src/interp/interpreter.ts';
import { bundle, BundleError } from '../src/tools/wasm-bundle.ts';
import { LinkingFormatError } from '../src/core/linking.ts';
import { readBinary } from '../src/compat/binaryen-compat.ts';
import { encodeU32Leb128 } from '../src/core/leb128.ts';
import { NESTING_TOO_DEEP } from '../src/core/error.ts';

import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { join } from 'node:path';

const [corpus, strideArg] = process.argv.slice(2);
if (corpus === undefined) {
  console.error('usage: bun run hostile <corpus dir of .wasm files> [stride=7]');
  process.exit(2);
}
const stride = Number(strideArg ?? 7);

const isTyped = (e: unknown) =>
  e instanceof WasmBinaryError || e instanceof WasmEncodeError || e instanceof BundleError ||
  e instanceof LinkingFormatError || e instanceof Stop || e instanceof Trap ||
  ((e as Error)?.message ?? '').includes(NESTING_TOO_DEEP);

let broken = 0;

// ---------------------------------------------------------------------------
// 1. Depth
// ---------------------------------------------------------------------------

const leb = (n: number) => [...encodeU32Leb128(n)];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
function deepBlocks(n: number): Uint8Array {
  const body = [0x00, ...Array(n).fill([0x02, 0x40]).flat(), ...Array(n).fill(0x0b), 0x0b];
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [1, 0]),
    ...section(7, [1, 1, 0x66, 0x00, 0]),
    ...section(10, [1, ...leb(body.length), ...body]),
  ]);
}

type Outcome = 'works' | 'too deep' | 'RAW';
function depthOutcome(f: () => unknown): [Outcome, string] {
  try {
    const r = f() as { errors?: { message: string }[]; [k: number]: unknown } | undefined;
    const said = r?.errors?.map((e) => e.message).join(' ') ?? JSON.stringify(r ?? '');
    return [said.includes(NESTING_TOO_DEEP) ? 'too deep' : 'works', ''];
  } catch (e) {
    if (isTyped(e)) {
      return [(e as Error).message.includes(NESTING_TOO_DEEP) ? 'too deep' : 'works', ''];
    }
    return [
      'RAW',
      `${(e as Error)?.constructor?.name}: ${String((e as Error)?.message).slice(0, 70)}`,
    ];
  }
}

const depthStages: Record<string, (n: number) => unknown> = {
  'wat2wasm': (n) => wat2wasm(`(module (func ${'(block '.repeat(n)}${')'.repeat(n)}))`),
  'wasm2wat': (n) => wasm2wat(deepBlocks(n)),
  'wasmValidate': (n) => wasmValidate(deepBlocks(n)),
  'readForPasses': (n) => readForPasses(deepBlocks(n)),
  'writeWasm': (n) => writeWasm(readForPasses(deepBlocks(n))),
  'writeWat': (n) => writeWat(readForPasses(deepBlocks(n))),
  'wasm-opt -Oz': (n) => {
    const m = readForPasses(deepBlocks(n));
    new PassRunner(m, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
    return writeWasm(m);
  },
  'interp': (n) => interpModule(readForPasses(deepBlocks(n)), { runAllExports: true }),
  'bundle': (n) =>
    bundle([{ name: 'a', module: readForPasses(deepBlocks(n)) }], { log: undefined }),
  'compat.readBinary': (n) => readBinary(deepBlocks(n)),
};

const depths = [500, 2_000, 5_000, 20_000, 100_000];
console.log(`=== depth: ${depths.join(' / ')} nested blocks ===`);
for (const [stage, run] of Object.entries(depthStages)) {
  const row = depths.map((n) => {
    const [o, why] = depthOutcome(() => run(n));
    if (o === 'RAW') {
      broken++;
      console.log(`  RAW ${stage} @${n}: ${why}`);
    }
    return o === 'works' ? 'ok' : o === 'too deep' ? 'deep' : 'RAW';
  });
  console.log(`  ${stage.padEnd(18)} ${row.map((x) => x.padEnd(5)).join(' ')}`);
}

// ---------------------------------------------------------------------------
// 2. Mutation fuzz
// ---------------------------------------------------------------------------

const files: string[] = [];
for (const e of readdirSync(corpus, { withFileTypes: true, recursive: true })) {
  if (!e.isDirectory() && e.name.endsWith('.wasm')) files.push(join(e.parentPath, e.name));
}
files.sort();
const sample = files.filter((_, i) => i % stride === 0);

function* mutants(b: Uint8Array): Generator<[string, Uint8Array]> {
  for (let k = 1; k <= 12; k++) {
    const at = 8 + Math.floor(((b.length - 8) * k) / 13);
    yield [`trunc@${at}`, b.slice(0, at)];
  }
  const vals = [0x00, 0x7f, 0xff, 0x80];
  for (let k = 1; k <= 24; k++) {
    const at = 8 + Math.floor(((b.length - 9) * k * 7919) % (b.length - 8));
    const v = vals[k % 4]!;
    if (b[at] === v) continue;
    const m = b.slice();
    m[at] = v;
    yield [`byte@${at}=${v.toString(16)}`, m];
  }
}

type Cls = 'ok' | 'typed' | 'UNTYPED' | 'SLOW';
const counts = new Map<string, Map<Cls, number>>();
const raw = new Map<string, string[]>();
function attempt(stage: string, where: string, f: () => void): boolean {
  const t = performance.now();
  const note = (cls: Cls, detail?: string) => {
    const m = counts.get(stage) ?? new Map<Cls, number>();
    m.set(cls, (m.get(cls) ?? 0) + 1);
    counts.set(stage, m);
    if (detail !== undefined) {
      broken++;
      const key = `${stage}: ${detail}`;
      raw.set(key, [...(raw.get(key) ?? []), where]);
    }
  };
  try {
    f();
    const ms = performance.now() - t;
    if (ms > 5000) note('SLOW', `SLOW ${(ms / 1000).toFixed(1)}s`);
    else note('ok');
    return true;
  } catch (e) {
    if (isTyped(e)) {
      note('typed');
      return false;
    }
    const err = e as Error;
    // Separators normalized first: on Windows, Node and Bun print stack paths with `\`, where
    // Deno printed `file:///` URLs (Bun migration B4). Without it every location read `?`.
    const at = (err?.stack ?? '').split('\n').map((l) => l.replace(/\\/g, '/'))
      .find((l) => l.includes('/src/'))
      ?.replace(/^.*\/src\//, '').replace(/\).*$/, '') ?? '?';
    note('UNTYPED', `${err?.constructor?.name}: ${String(err?.message).slice(0, 60)} @ ${at}`);
    return false;
  }
}

let n = 0;
for (const path of sample) {
  const original = new Uint8Array(readFileSync(path));
  const name = path.replace(/^.*[\\/]/, '');
  for (const [how, bytes] of mutants(original)) {
    n++;
    const where = `${name} ${how}`;
    if (attempt('readForPasses', where, () => void readForPasses(bytes))) {
      attempt('opt -O2 + write', where, () => {
        // As `wasm-opt` reads: VALIDATED first — the passes' contract is a valid module.
        const mod = readValidForPasses(bytes);
        new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 0 }).addDefaultOptimizationPasses()
          .run();
        writeWasm(mod);
      });
      attempt(
        'interp',
        where,
        () =>
          void interpModule(readForPasses(bytes), {
            runAllExports: true,
            fuel: 200_000,
            dummyImportFunc: true,
          }),
      );
      attempt(
        'bundle',
        where,
        () =>
          void bundle([{ name: 'a', module: readForPasses(bytes) }], {
            log: undefined,
            unmarked: 'guess',
          }),
      );
    }
    attempt('compat.readBinary', where, () => void readBinary(bytes));
  }
}
console.log(
  `=== mutation fuzz: ${sample.length} modules (every ${stride}th of ${files.length}), ${n} mutants ===`,
);
for (const [stage, m] of counts) {
  const cells = (['ok', 'typed', 'UNTYPED', 'SLOW'] as Cls[]).map((c) => `${c} ${m.get(c) ?? 0}`);
  console.log(`  ${stage.padEnd(18)} ${cells.join('  ')}`);
}
for (const [k, where] of [...raw].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(where.length).padStart(4)}×  ${k}   e.g. ${where[0]}`);
}
console.log(
  broken === 0 ? 'TOTAL — nothing escaped untyped, nothing ran away.' : `TOTAL — ${broken} broken`,
);
process.exit(broken === 0 ? 0 : 1);
