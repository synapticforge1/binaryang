// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// T13.25 — a control byte in a source file makes that file INVISIBLE to grep.
//
// This gate does not protect the product. It protects the AUDIT METHOD, which
// is the only thing that has been finding bugs here lately.
//
// A `\0` sentinel got written into `src/bridge/binaryen-bridge.ts` (T13.24's
// `IF_FRAME`). Everything downstream stayed green — `deno check`, `deno lint`,
// `deno fmt`, and the full suite all pass, because a NUL is a legal character
// in a TypeScript string literal. What broke was silent and off to the side:
//
//     $ grep -rn "naturalAlignForOpcode" src/
//     Binary file src/bridge/binaryen-bridge.ts matches
//
// grep classifies a file containing a NUL as binary and prints that line
// INSTEAD of the matches. The bridge dropped out of an alignment-duplication
// sweep entirely, and the sweep reported clean. Every enumeration in
// `cmem/INDEX.md`'s audit definition — `Var`-bearing fields, `Expr`-bearing
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

import { describe, it } from '@std/testing/bdd';
import { assert } from '@std/assert';

// `cmem/` and `README.md` are in scope too, and were NOT at first — which is
// how T13.28 happened: five control bytes accumulated across three memory
// files, making `cmem/tasks.md` and `cmem/design-decisions.md` BINARY to grep.
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
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (e.isFile && (p.endsWith('.ts') || p.endsWith('.md'))) yield p;
  }
}

describe('T13.25 — source stays greppable', () => {
  it('contains no control bytes in any file the workflow greps', async () => {
    const base = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const offenders: string[] = [];
    let scanned = 0;

    for (const path of EXTRA_FILES.map((f) => `${base}${f}`)) {
      scanned++;
      const bad = controlBytes(await Deno.readFile(path));
      if (bad.length > 0) {
        offenders.push(
          `${path.slice(base.length)}: ${bad.length} control byte(s), first at offset ${bad[0]}`,
        );
      }
    }
    for (const root of ROOTS) {
      for await (const path of walk(`${base}${root}`)) {
        scanned++;
        const bad = controlBytes(await Deno.readFile(path));
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
