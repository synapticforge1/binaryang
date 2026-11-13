// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.25 — a control byte in a source file makes that file INVISIBLE to grep.
//
// This gate does not protect the product. It protects the AUDIT METHOD, which
// is the only thing that has been finding bugs here lately.
//
// A `\0` sentinel got written into `src/bridge/bridge.ts` (T13.24's
// `IF_FRAME`). Everything downstream stayed green — `deno check`, `deno lint`,
// `deno fmt`, and the full suite all pass, because a NUL is a legal character
// in a TypeScript string literal. What broke was silent and off to the side:
//
//     $ grep -rn "naturalAlignForOpcode" src/
//     Binary file src/bridge/bridge.ts matches
//
// grep classifies a file containing a NUL as binary and prints that line
// INSTEAD of the matches. The bridge dropped out of an alignment-duplication
// sweep entirely, and the sweep reported clean. Every enumeration in
// `cmem/wabt-ts.md` § "The audit definition" — `Var`-bearing fields, `Expr`-bearing
// fields, delegate hooks, arity tables, handler families — is grep- or
// regex-driven over the source, so one invisible byte silently narrows the
// population that every one of them measures, and each still reports success.
//
// That is the worst shape in the audit definition (a silent fall-through) in
// the tooling rather than in the code. Hence a gate: cheap, total over the
// source tree, and it fails loudly.
//
// The NUL was a bad choice on its own merits too — `IF_FRAME` is now the
// visible `'<if-frame>'`, which cannot collide with a real label either, since
// those always begin with `$`.

import { describe, it } from 'node:test';
import { assert } from '@std/assert';
import * as fsx from '../../test_fs.ts';

// `cmem/` and `README.md` are in scope too, and were NOT at first — which is
// how T13.28 happened: five control bytes accumulated across three memory
// files, making wabt-ts's `tasks.md` and `design-decisions.md` BINARY to grep
// (both at the root of its `cmem/` then, in binaryang's wabt-ts wing after the merge,
// and summarized into `cmem/wabt-ts.md` since 2026-09-14).
// Searching project memory is itself a grep, and one of the corrupted bytes was
// a `\b` inside the documented id-lookup command, so the instruction the ledger
// gives for picking the next tranche id was silently broken.
//
// The lesson generalises past this repo: **scope a hygiene gate to every file
// the workflow greps, not just the files that compile.**
const ROOTS = ['src', 'tests', 'cmem'];
const EXTRA_FILES = ['README.md'];

/** Control characters that are never legitimate in this source tree. TAB (9), LF (10) and CR (13) are. */
function controlBytes(bytes: Uint8Array): number[] {
  const bad: number[] = [];
  for (const [i, b] of bytes.entries()) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 0x20 || b === 0x7f) bad.push(i);
  }
  return bad;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of fsx.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (e.isFile && (p.endsWith('.ts') || p.endsWith('.md'))) yield p;
  }
}

describe('T13.25 — source stays greppable', () => {
  it('contains no control bytes in any file the workflow greps', async () => {
    const base = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders: string[] = [];
    let scanned = 0;

    for (const path of EXTRA_FILES.map((f) => `${base}${f}`)) {
      scanned++;
      const bad = controlBytes(await fsx.readFile(path));
      if (bad.length > 0) {
        offenders.push(
          `${path.slice(base.length)}: ${bad.length} control byte(s), first at offset ${bad[0]}`,
        );
      }
    }
    for (const root of ROOTS) {
      for await (const path of walk(`${base}${root}`)) {
        scanned++;
        const bad = controlBytes(await fsx.readFile(path));
        if (bad.length > 0) {
          const rel = path.slice(base.length);
          offenders.push(`${rel}: ${bad.length} control byte(s), first at offset ${bad[0]}`);
        }
      }
    }

    // If the walk finds nothing the assertion below is vacuous, so pin the
    // population too — the same "guard the guard" step T13.24 added.
    assert(scanned > 100, `only scanned ${scanned} files — the walk is broken, not the tree clean`);
    assert(
      offenders.length === 0,
      `control bytes make a file invisible to grep, and every audit enumeration here is ` +
        `grep-driven — the sweep will report clean while skipping the file:\n  ` +
        offenders.join('\n  '),
    );
  });
});

// Security review round 1 (2026-11-13), C13: nine shipped files opened with no attribution —
// whose code it is and under which licence. Every `.ts` the package ships opens with one of the
// two forms the tree uses: a port, "Based on" or "Ported from" <upstream> with its original
// source, copyright and Apache-2.0 line; or the project's own, "Copyright (c) 2026 Jon Marcum"
// and the MIT line. A generated file carries it from its generator (`scripts/definitions.ts`).
const PORT =
  /^\/\/ (?:Based on|Ported from) WebAssembly\/(binaryen|wabt) \(https:\/\/github\.com\/WebAssembly\/\1\)\n\/\/ Original source: .+\n(?:\/\/ {2,}\S.*\n)*\/\/ Copyright .+\n\/\/ Licensed under the Apache License, Version 2\.0\n/;
const OWN =
  /^\/\/ Copyright \(c\) 2026 Jon Marcum\n\/\/ Licensed under the MIT License\. See LICENSE-MIT in the repository root\.\n/;

/** Whether `text` opens with an attribution, after a shebang if it has one. */
export function attributed(text: string): boolean {
  const body = text.replace(/\r\n/g, '\n').replace(/^#!.*\n/, '');
  return PORT.test(body) || OWN.test(body);
}

describe('C13 — every shipped source file says whose it is', () => {
  it('src/**/*.ts and main.ts each open with an attribution', async () => {
    const base = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders: string[] = [];
    let scanned = 0;
    const files = [`${base}main.ts`];
    for await (const path of walk(`${base}src`)) if (path.endsWith('.ts')) files.push(path);
    for (const path of files) {
      scanned++;
      if (!attributed(await fsx.readTextFile(path))) offenders.push(path.slice(base.length));
    }
    assert(scanned > 100, `only scanned ${scanned} files — the walk is broken, not the tree clean`);
    assert(offenders.length === 0, `no attribution header:\n  ${offenders.join('\n  ')}`);
  });

  it('the check knows both forms, a shebang, and a file without either', () => {
    assert(
      attributed(
        '// Copyright (c) 2026 Jon Marcum\n// Licensed under the MIT License. See LICENSE-MIT in the repository root.\n',
      ),
    );
    assert(
      attributed(
        '#!/usr/bin/env node\n// Copyright (c) 2026 Jon Marcum\r\n// Licensed under the MIT License. See LICENSE-MIT in the repository root.\r\n',
      ),
    );
    assert(
      attributed(
        '// Based on WebAssembly/wabt (https://github.com/WebAssembly/wabt)\n// Original source: src/x.cc\n// Copyright 2016 WebAssembly Community Group participants\n// Licensed under the Apache License, Version 2.0\n',
      ),
    );
    assert(
      attributed(
        '// Ported from WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)\n// Original source: src/passes/X.cpp\n// Copyright 2019 WebAssembly Community Group participants\n// Licensed under the Apache License, Version 2.0\n',
      ),
    );
    assert(!attributed('/**\n * @module x\n */\n'));
    assert(!attributed('// GENERATED by scripts/definitions.ts\n'));
    assert(
      !attributed(
        '\n// Copyright (c) 2026 Jon Marcum\n// Licensed under the MIT License. See LICENSE-MIT in the repository root.\n',
      ),
    );
  });
});
