// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// 1.11.0: `./compat/wabt`'s `Features` and `WasmModule` were renamed
// `WabtFeatures` and `WabtWasmModule`, so each name has one meaning in
// binaryang (`Features` is the validator's feature set, `WasmModule` the IR's
// module record — both in `./ir`). The old names stayed one release as deprecated
// aliases, and went after it (open-work 25, 2026-10-14). Pinned: the old names are
// GONE (each `@ts-expect-error` below would go unused, and fail `bun run check`, if
// one came back), and the handle `parseWat` returns is typed by the new name.

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import initWabt, {
  type WabtFeatures,
  type WabtWasmModule,
} from '../../../src/compat/wabt-compat.ts';
// @ts-expect-error -- `Features` was removed after 1.11.0: use `WabtFeatures`
import type { Features as _GoneFeatures } from '../../../src/compat/wabt-compat.ts';
// @ts-expect-error -- `WasmModule` was removed after 1.11.0: use `WabtWasmModule`
import type { WasmModule as _GoneWasmModule } from '../../../src/compat/wabt-compat.ts';

describe('compat/wabt type names', () => {
  it('the old names are gone (the imports above must fail to type-check)', () => {
    // Referenced so the imports count as used; what is pinned is that importing them is an error.
    const gone: [_GoneFeatures?, _GoneWasmModule?] = [];
    expect(gone).toEqual([]);
  });

  it('parseWat returns a WabtWasmModule and takes WabtFeatures', async () => {
    const wabt = await initWabt();
    const flags: WabtFeatures = { reference_types: true };
    const handle: WabtWasmModule = wabt.parseWat('t.wat', '(module)', flags);
    expect(handle.toBinary({}).buffer.byteLength).toBeGreaterThan(0);
    handle.destroy();
  });
});
