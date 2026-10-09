/**
 * @module binaryen-ts/passes/memory-packing
 *
 * MemoryPacking (open-work 2, step 6e, 2026-10-08): the data segments of a
 * memory, rewritten as the fewest bytes that build the same image. Every
 * active segment is applied in order to an image of the memory, and the
 * image is written back as segments split only where a run of zeros is
 * longer than a segment header costs (`packMemory`, which `wasm-ctor-eval`
 * writes its memory with): adjacent segments merge, zero padding goes.
 *
 * Only where the image is provably the same at every instantiation:
 *
 * - one memory, DEFINED here (an imported memory's size is the host's, so an
 *   out-of-bounds segment — which traps at instantiation — cannot be told);
 * - every segment ACTIVE, on that memory, with a constant `i32` offset; no
 *   passive segment (one may be named by index from code, which renumbering
 *   would break) and no instruction that names a segment (`memory.init`,
 *   `data.drop`, `array.new_data`, `array.init_data`);
 * - the image ends within the memory's initial size — the original would
 *   trap at instantiation past it, and so must the output.
 *
 * Measured first, on our -Oz output (`memshapes.ts`): 421 of 421 corpus
 * modules eligible; 38,058 bytes of data entries in 1,381 segments → 29,901
 * in 390. Upstream: `MemoryPacking.cpp`, which also handles the passive and
 * bulk-memory cases this one leaves alone.
 *
 * @license MIT
 */

import { type Expression, ExpressionKind, makeConst, makeRegion } from '../ir/expressions.ts';
import type { WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { walkExpression } from '../ir/walk.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import { type DataSegment, varIndex } from '../../wabt-ts/ir/ir.ts';
import { packMemory } from '../tools/wasm-ctor-eval.ts';
import { type Pass, type PassOptions, registerPass } from './pass.ts';

// ---------------------------------------------------------------------------
// Pass class
// ---------------------------------------------------------------------------

/** Rewrites a memory's data segments as the fewest bytes that build the same image. */
export class MemoryPackingPass implements Pass {
  readonly name = 'MemoryPacking';
  readonly description =
    'Merges adjacent data segments and drops zero runs, keeping the memory image identical.';
  readonly requiresNonNullableLocalFixups = false;

  run(module: WasmModule, _options: PassOptions): void {
    packModule(module);
  }
}

registerPass(MemoryPackingPass);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const NAMES_A_SEGMENT = new Set<string>([
  ExpressionKind.MemoryInit,
  ExpressionKind.DataDrop,
  ExpressionKind.ArrayNewData,
  ExpressionKind.ArrayInitData,
]);

/** Packs `module`'s data segments when the conditions above hold; returns whether it did. */
export function packModule(module: WasmModule): boolean {
  if (module.memories.length !== 1) return false;
  if (module.imports.some((i) => i.kind === ExternalKind.Memory)) return false;
  const memory = module.memories[0]!;
  if (memory.limits.is64) return false;
  const segments: { offset: number; data: Uint8Array }[] = [];
  for (const d of module.dataSegments) {
    const c = d.offset?.children;
    if (
      d.kind !== 'active' || c?.length !== 1 || c[0]!.kind !== ExpressionKind.Const ||
      c[0]!.value.type !== ValType.I32
    ) return false;
    segments.push({ offset: c[0]!.value.value >>> 0, data: d.data });
  }
  if (segments.length === 0) return false;
  for (const fn of module.functions) {
    let names = false;
    walkExpression(fn.body as unknown as Expression, (e) => {
      if (NAMES_A_SEGMENT.has(e.kind)) names = true;
    });
    if (names) return false;
  }
  const pageSize = 1n << BigInt(memory.limits.pageSizeLog2 ?? 16);
  const end = segments.reduce((n, s) => Math.max(n, s.offset + s.data.length), 0);
  if (BigInt(end) > memory.limits.initial * pageSize) return false;
  const image = new Uint8Array(end);
  for (const s of segments) image.set(s.data, s.offset);
  const packed: DataSegment[] = packMemory(image).map(({ offset, data }) => ({
    name: '',
    kind: 'active',
    memoryVar: varIndex(0),
    offset: makeRegion([makeConst({ type: ValType.I32, value: offset })]),
    data,
  }));
  module.dataSegments.splice(0, module.dataSegments.length, ...packed);
  return true;
}
