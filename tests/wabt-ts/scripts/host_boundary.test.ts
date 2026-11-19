// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

// The `host` boundary (workspace letter H39, owner, 2026-11-19): only `src/host.ts` reaches the
// system. `scripts/check-portability.ts` holds it over the shipped tree; this pins what its
// matcher accepts and refuses, so a loosened pattern fails here and not silently there.

import { describe, it } from 'node:test';
import { assertEquals } from '@std/assert';
import { isSystemCall } from '../../../scripts/check-portability.ts';

describe('H39: what counts as reaching the system outside host.ts', () => {
  it('every import form of a file, path, OS or process module', () => {
    for (
      const line of [
        "import { readFile } from 'node:fs/promises';",
        "import * as fs from 'node:fs';",
        "import type nodeProcess from 'node:process';",
        "  const { join } = await import('node:path');",
        "const { spawnSync } = require('node:child_process');",
        'import { tmpdir } from "node:os";',
        "import { win32 } from 'node:path/win32';",
      ]
    ) assertEquals(isSystemCall(line), true, line);
  });

  it("a runtime's own global", () => {
    for (
      const line of [
        'await Bun.write(path, data);',
        'const p = globalThis.process;',
        'const b = globalThis . Bun;',
      ]
    ) assertEquals(isSystemCall(line), true, line);
  });

  it('not comments, not other modules, not look-alikes', () => {
    for (
      const line of [
        ' * import { writeFile } from "node:fs/promises";',
        "// await import('node:fs/promises') is host's",
        "import { Buffer } from 'node:buffer';",
        'const p = cliProcess(); p.argv.slice(2);',
        'const fsBun = myBun.file;',
        "const s = 'node:fsx';",
      ]
    ) assertEquals(isSystemCall(line), false, line);
  });
});
