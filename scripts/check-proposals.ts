// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The spec testsuite's `proposals/` in the gate (owner, 2026-09-29: both
 * halves, V8's experimental flags included). For each proposal in
 * `proposals.ts`:
 *
 * 1. prepare `testsuite-main/proposals/<name>` as `spec:prepare` does;
 * 2. VALIDITY — `spec-testsuite.ts --proposal <name>`: accept what must be
 *    accepted, reject what must be rejected, under the feature set its suite
 *    is written against;
 * 3. BEHAVIOUR — `check-spec-behaviour.ts --proposal <name>` in a process
 *    started with that proposal's `--v8-flags` (a flag cannot be set inside a
 *    running isolate): every invocation, original vs every variant.
 *
 * A proposal no engine here can run (`noEngine`) reports its behaviour as NOT
 * RUN, with why — never as passing.
 *
 * ⚠️ When a Deno upgrade renames or retires a flag, V8 only warns; the
 * behaviour step then FAILS with "engine refused ORIGINAL" (it would otherwise
 * have compared nothing and agreed). Adjust the row in `proposals.ts`.
 *
 * Usage: `bun run proposals <testsuite-main> <outDir>` (`<outDir>` in the
 * session scratchpad, as for `spec:prepare`).
 */

import { PROPOSALS } from './proposals.ts';

import process from 'node:process';
import { spawnSync } from 'node:child_process';

const [suite, out] = process.argv.slice(2);
if (suite === undefined || out === undefined) {
  console.error('usage: bun run proposals <testsuite-main> <outDir>');
  process.exit(2);
}

const here = (f: string) => new URL(f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Runs `script` with `args`; its exit status and the output's last meaningful lines.
 *
 * Preparation and validity use no WebAssembly engine, so they run on the runtime running
 * this script. The BEHAVIOUR step (`v8` set) is an engine ORACLE whose flags are V8's, so it
 * runs on Node whatever runs this script: Bun's engine is JavaScriptCore, which (measured
 * 2026-10-12, Bun 1.4.3) lacks memory64 and accepts 70 core modules the spec rejects, while
 * Node's V8 agreed with Deno's on all 6,753 corpus modules (cmem/bun-migration.md § "The
 * engine oracle"). Node takes V8 flags directly (Deno wrapped them in `--v8-flags=`).
 */
function sub(
  script: string,
  args: string[],
  engine?: { runtime: 'node' | 'deno' | 'bun'; flags: string[] },
): { ok: boolean; tail: string[] } {
  const [bin, pre]: [string, string[]] = engine === undefined
    ? [process.execPath, process.execArgv]
    : engine.runtime === 'node'
    ? ['node', ['--experimental-transform-types', '--no-warnings', ...engine.flags]]
    : engine.runtime === 'deno'
    ? ['deno', [
      'run',
      '-A',
      ...(engine.flags.length ? [`--v8-flags=${engine.flags.join(',')}`] : []),
    ]]
    : ['bun', []];
  // NO_COLOR: the output is relayed and filtered, so no escape codes in it.
  const r = spawnSync(bin, [...pre, script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 30,
  });
  const text = r.stdout.toString('utf8') + r.stderr.toString('utf8');
  return { ok: r.status === 0, tail: text.split('\n').filter((l) => l.trim() !== '') };
}

let failed = 0;
const summary: string[] = [];
for (const p of PROPOSALS) {
  const dir = `${out}/${p.name}`;
  console.log(`\n===== proposals/${p.name}`);

  const prep = sub(here('./spec-prepare.ts'), [`${suite}/proposals/${p.name}`, dir]);
  if (!prep.ok) {
    console.log(prep.tail.slice(-5).join('\n'));
    summary.push(`${p.name.padEnd(20)} PREPARE FAILED`);
    failed++;
    continue;
  }

  const validity = sub(here('./spec-testsuite.ts'), [dir, '--proposal', p.name]);
  console.log(validity.tail.filter((l) => !l.startsWith('Task')).join('\n'));

  let behaviour: string;
  if (p.noEngine !== undefined) {
    behaviour = `NOT RUN — ${p.noEngine}`;
    console.log(`  behaviour: ${behaviour}`);
  } else {
    const engine = { runtime: p.engine ?? 'node', flags: p.v8Flags } as const;
    const b = p.behaviourScript !== undefined
      ? sub(here(p.behaviourScript), [dir], engine)
      : sub(here('./check-spec-behaviour.ts'), [dir, '--proposal', p.name], engine);
    console.log(b.tail.join('\n'));
    behaviour = b.ok ? 'ok' : 'FAILED';
    if (!b.ok) failed++;
  }
  if (!validity.ok) failed++;
  summary.push(
    `${p.name.padEnd(20)} validity ${validity.ok ? 'ok    ' : 'FAILED'}  behaviour ${behaviour}` +
      (p.noEngine === undefined ? `  on ${p.engine ?? 'node'}` : '') +
      (p.v8Flags.length > 0 ? `  (${p.v8Flags.join(' ')})` : ''),
  );
}

console.log('\n  === proposals/ ===');
for (const s of summary) console.log(`    ${s}`);
console.log(failed === 0 ? '\n  every proposal holds' : `\n  ✗ ${failed} step(s) failed`);
process.exit(failed === 0 ? 0 : 1);
