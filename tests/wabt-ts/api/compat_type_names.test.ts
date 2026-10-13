// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// 1.11.0: `./compat/wabt`'s `Features` and `WasmModule` were renamed
// `WabtFeatures` and `WabtWasmModule`, so each name has one meaning in
// binaryang (`Features` is the validator's feature set, `WasmModule` the IR's
// module record — both in `./ir`). The old names stay one release as deprecated
// aliases (open-work 25 removes them). Pinned: each alias IS its new type, and
// the handle `parseWat` returns is typed by the new name.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import initWabt, {
  type Features,
  type WabtFeatures,
  type WabtWasmModule,
  type WasmModule,
} from '../../../src/compat/wabt-compat.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('compat/wabt type names', () => {
  it('the deprecated names are aliases of the new ones', () => {
    const features: Same<Features, WabtFeatures> = true;
    const module: Same<WasmModule, WabtWasmModule> = true;
    expect([features, module]).toEqual([true, true]);
  });

  it('parseWat returns a WabtWasmModule and takes WabtFeatures', async () => {
    const wabt = await initWabt();
    const flags: WabtFeatures = { reference_types: true };
    const handle: WabtWasmModule = wabt.parseWat('t.wat', '(module)', flags);
    expect(handle.toBinary({}).buffer.byteLength).toBeGreaterThan(0);
    handle.destroy();
  });
});
