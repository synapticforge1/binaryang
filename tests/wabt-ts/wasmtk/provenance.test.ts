// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';

// T13.45. `tests/wasmtk/` is a frozen snapshot of another project's build
// output. Its PROVENANCE.md carried "Snapshot date: unknown" and "Source
// commit: unknown" for three months -- a claim nobody had checked, since one
// `git log --diff-filter=A` in THIS repository answers it.
//
// In the meantime the missing stamp produced three wrong claims sent to the
// wasmtk team (the KNOWN_INVALID seven, the EH scope 6-vs-10, and the
// needsExceptionTag five), and cost them two requests for a stamp.
//
// This gate makes the stamp non-optional. The load-bearing check is the FILE
// COUNT: a refresh that moves files without re-stamping is exactly the failure
// mode, and it is the one a human is most likely to commit in a hurry.

const DIR = 'tests/wasmtk';
const DOC = await Deno.readTextFile(`${DIR}/PROVENANCE.md`);

/** The value cell of a `| Label | value |` row. */
function row(label: string): string {
  for (const line of DOC.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is the empty string before the leading pipe.
    if (cells.length >= 3 && cells[1] === label) return cells[2]!;
  }
  return '';
}

async function watCount(): Promise<number> {
  let n = 0;
  for await (const e of Deno.readDir(DIR)) {
    if (e.isFile && e.name.endsWith('.wat')) n++;
  }
  return n;
}

describe('T13.45 — the corpus snapshot carries its provenance', () => {
  it('states a source commit, not "unknown"', () => {
    const v = row('Source commit');
    expect(v).not.toEqual('');
    expect(v.toLowerCase()).not.toContain('unknown');
    // A real short-or-long git hash appears somewhere in the cell.
    expect(/\b[0-9a-f]{7,40}\b/.test(v)).toBe(true);
  });

  it('states a snapshot date, not "unknown"', () => {
    const v = row('Snapshot date');
    expect(v).not.toEqual('');
    expect(v.toLowerCase()).not.toContain('unknown');
    expect(/\b20\d{2}-\d{2}-\d{2}\b/.test(v)).toBe(true);
  });

  // The one that catches a refresh. Re-generating the corpus changes the file
  // count; if the table still says 272, the stamp was not updated either.
  it('the declared file count matches what is on disk', async () => {
    const declared = row('Files here').match(/\d+/);
    expect(declared).not.toBeNull();
    expect(Number(declared![0])).toEqual(await watCount());
  });

  it('still says plainly that it is a snapshot', () => {
    // The rule this whole file exists to enforce. If someone rewrites the doc
    // and drops the warning, the fixtures start reading as evidence again.
    expect(DOC).toContain('FROZEN SNAPSHOT');
    expect(DOC.toLowerCase()).toContain('re-derive before reporting upstream');
  });

  it('records what the snapshot has already cost, so the risk stays concrete', () => {
    // Three wrong claims, all caught by the recipient. A doc that keeps the
    // rule but drops the incidents becomes advice nobody weights.
    expect(DOC).toContain('three');
    expect(DOC).toContain('KNOWN_INVALID');
  });
});
