// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// C-R2-1 (security review round 4): no gate compared binaryang's `wat2wasm` with the REAL wabt
// `wat2wasm`. `scripts/check-wat2wasm.ts` does, over the wasmtk fixtures and every text module of
// the spec scripts (measured 2026-11-20: 2,574 texts, 2,441 byte-identical to wabt, 118 more to
// `wasm-tools` where wabt has no GC text, 4 listed differences against wabt, 0 rejected by us).
// These tests pin its pieces: the text-module cutter, the section comparison and its one
// documented normalisation (name subsections 3 and 10, N2), that a REAL upstream run feeds it (a
// planted byte difference is caught, an identical one is not), and that a missing `wat2wasm` FAILS
// naming how to install it rather than skipping.

import { assert, assertEquals } from '@std/assert';

import { wat2wasm } from '../../../src/tools/wat2wasm.ts';
import {
  differences,
  differencesPlain,
  isTextModule,
  sectionsOf,
  topLevelForms,
  upstream,
  wasmTools,
} from '../../../scripts/check-wat2wasm.ts';
import * as fsx from '../../test_fs.ts';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('the cutter takes top-level forms and skips comments and strings holding parentheses', () => {
  const src = `;; (module not-this)
(module $a (func (export "(") ) ) (; (module nor-this) ;)
(assert_return (invoke "f") (i32.const 1))
(module binary "\\00asm")`;
  const forms = topLevelForms(src);
  assertEquals(forms.length, 3);
  assertEquals(forms[0], '(module $a (func (export "(") ) )');
  assert(forms[1]!.startsWith('(assert_return'));
});

test('a text module is not a `binary`, `quote`, `definition` or `instance` one', () => {
  assert(isTextModule('(module)'));
  assert(isTextModule('(module $m (func))'));
  assert(isTextModule('(module\n  (func))'));
  assert(!isTextModule('(module binary "\\00asm\\01\\00\\00\\00")'));
  assert(!isTextModule('(module $m quote "(func)")'));
  assert(!isTextModule('(module definition $d (func))'));
  assert(!isTextModule('(module instance $i $d)'));
  assert(!isTextModule('(assert_return (invoke "f"))'));
});

/** A module as bytes: header, then sections `[id, ...payload]` (name = a custom section's name). */
function module(...sections: { id: number; payload: number[]; name?: string }[]): Uint8Array {
  const out = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
  for (const s of sections) {
    const body = s.id === 0
      ? [s.name!.length, ...[...s.name!].map((c) => c.charCodeAt(0)), ...s.payload]
      : s.payload;
    out.push(s.id, body.length, ...body);
  }
  return new Uint8Array(out);
}
const names = (...subs: [number, number[]][]) => ({
  id: 0,
  name: 'name',
  payload: subs.flatMap(([id, b]) => [id, b.length, ...b]),
});

test('the comparison reports a changed section, and only the N2 name subsections are forgiven', () => {
  const code = (b: number) => ({ id: 10, payload: [1, 4, 0, 0x41, b, 0x0b] });
  const a = module(code(1), names([1, [0]]));
  assertEquals(differences(a, module(code(1), names([1, [0]]))), []);
  assertEquals(differences(a, module(code(2), names([1, [0]]))), ['section 10']);
  // Label names (3) and field names (10) are binaryang's own (N2): not a difference...
  assertEquals(differences(a, module(code(1), names([1, [0]], [3, [0]], [10, [0]]))), []);
  // ...but every other name subsection, and the function names themselves, are compared.
  assertEquals(differences(a, module(code(1), names([1, [1]]))), ['name subsection 1']);
  assertEquals(differences(a, module(code(1), names([1, [0]], [2, [0]]))), [
    'name subsection 2: only in ours',
  ]);
  // A section binaryang adds or drops, and a custom section it adds, are differences too.
  assertEquals(differences(a, module(code(1), { id: 5, payload: [0] }, names([1, [0]]))).length, 1);
  assertEquals(
    differences(a, module(code(1), names([1, [0]]), { id: 0, name: 'x', payload: [] })),
    ["custom 'x': only in ours"],
  );
  // wasm-tools' side compares only the non-custom sections.
  assertEquals(differencesPlain(a, module(code(1), names([9, [0]]))), []);
  assertEquals(differencesPlain(a, module(code(3))), ['section 10']);
});

function upstreamAvailable(): boolean {
  return spawnSync('wat2wasm', ['--version'], { encoding: 'utf8' }).status === 0;
}

test('a REAL upstream wat2wasm run is the other side: equal bytes pass, a planted change is caught', async () => {
  // Required, never skipped: a machine without wabt fails here, and the message says how to get it.
  assert(
    upstreamAvailable(),
    'upstream wat2wasm is REQUIRED (wabt 1.0.41+): scoop install wabt / brew install wabt / apt install wabt',
  );
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-' });
  try {
    const wat =
      '(module (func $f (export "f") (param i32) (result i32) (local.get 0) (i32.const 7) (i32.add)))';
    await fsx.writeTextFile(`${dir}/a.wat`, wat);
    const r = spawnSync('wat2wasm', [
      '--no-check',
      '--debug-names',
      `${dir}/a.wat`,
      '-o',
      `${dir}/a.wasm`,
    ]);
    assertEquals(r.status, 0);
    const theirs = await fsx.readFile(`${dir}/a.wasm`);
    const ours = wat2wasm(wat, { textForm: false }).binary;
    assertEquals(differences(theirs, ours), []);
    // Inversion: the same module with another constant is a difference in the code section.
    const other = wat2wasm(wat.replace('i32.const 7', 'i32.const 8'), { textForm: false }).binary;
    assertEquals(differences(theirs, other), ['section 10']);
    assert(sectionsOf(theirs).some((s) => s.id === 10));
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});

test('a missing upstream wat2wasm FAILS the step, naming how to install it', async () => {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-' });
  try {
    // An empty PATH: neither wat2wasm nor wasm-tools can be found. The runtime is started by its
    // absolute path, so only the tools the script looks for are missing.
    const r = spawnSync(process.execPath, [
      'scripts/check-wat2wasm.ts',
      dir,
      `${dir}/work`,
    ], { encoding: 'utf8', env: { ...process.env, PATH: dir, Path: dir } });
    assertEquals(r.status, 1);
    assert(r.stderr.includes('wat2wasm is REQUIRED'), r.stderr);
    assert(r.stderr.includes('scoop install wabt'), r.stderr);
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});

// --- Time limits and a missing output (hardening review F5) ---------------------------------------
// A hung `wat2wasm` / `wasm-tools` stalled the gate step for its whole 25-minute budget and left up
// to eight children behind; an exit 0 with no output file threw, uncaught, inside a 'close' handler.
// The tool is a FAKE one: this runtime running a script (a script on PATH cannot be started
// without a shell on Windows). The code under test spawns it exactly as it spawns the real tools.

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a hung wat2wasm is killed at the limit and the item reported as an ERROR naming it', async () => {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-slow-' });
  try {
    const pidFile = `${dir}/pid`;
    const slow = `${dir}/slow.cjs`;
    await fsx.writeTextFile(
      slow,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
        'setInterval(() => {}, 1000);',
    );
    const tool = { cmd: process.execPath, pre: [slow], limitMs: 1500 };
    const t0 = Date.now();
    const r = await upstream(`${dir}/a.wat`, `${dir}/a.wasm`, tool, 'custom/hung.wast#3');
    assert(Date.now() - t0 < 30_000, 'it returned long after the limit');
    assert('error' in r && r.infra === true, JSON.stringify(r));
    assert(r.error.includes('TIMED OUT') && r.error.includes('custom/hung.wast#3'), r.error);
    // The child is gone, not orphaned.
    const pid = Number(await fsx.readTextFile(pidFile));
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
    assert(!alive(pid), 'the hung wat2wasm child is still running');
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});

test('a hung wasm-tools is killed at the limit and reported as an ERROR naming the item', async () => {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-wt-slow-' });
  try {
    const slow = `${dir}/slow.cjs`;
    await fsx.writeTextFile(slow, 'setInterval(() => {}, 1000);');
    const tool = { cmd: process.execPath, pre: [slow], limitMs: 1500 };
    const r = wasmTools(`${dir}/a.wat`, `${dir}/a.wasm`, tool, 'if.wast#2');
    assert('error' in r && r.infra === true, JSON.stringify(r));
    assert(r.error.includes('TIMED OUT') && r.error.includes('if.wast#2'), r.error);
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});

test('exit 0 with no output file is an error naming the item, not an uncaught throw', async () => {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-nofile-' });
  try {
    const quiet = `${dir}/quiet.cjs`;
    await fsx.writeTextFile(quiet, 'process.exit(0);');
    const tool = { cmd: process.execPath, pre: [quiet], limitMs: 30_000 };
    const r = await upstream(`${dir}/a.wat`, `${dir}/missing.wasm`, tool, 'block.wast#0');
    assert('error' in r && r.infra === true, JSON.stringify(r));
    assert(r.error.includes('wrote no output') && r.error.includes('block.wast#0'), r.error);
    const w = wasmTools(`${dir}/a.wat`, `${dir}/missing.wasm`, tool, 'block.wast#0');
    assert(
      'error' in w && w.infra === true && w.error.includes('wrote no output'),
      JSON.stringify(w),
    );
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});

test('an oracle that rejects the text is a plain error, not an infrastructure one', async () => {
  const dir = await fsx.makeTempDir({ prefix: 'binaryang-w2w-reject-' });
  try {
    const bad = `${dir}/bad.cjs`;
    await fsx.writeTextFile(bad, "console.error('unexpected token'); process.exit(1);");
    const tool = { cmd: process.execPath, pre: [bad], limitMs: 30_000 };
    const r = await upstream(`${dir}/a.wat`, `${dir}/a.wasm`, tool, 'x#0');
    assert('error' in r && r.infra === undefined && r.error.includes('unexpected token'));
  } finally {
    await fsx.remove(dir, { recursive: true });
  }
});
