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
 * Usage: `deno task proposals <testsuite-main> <outDir>` (`<outDir>` in the
 * session scratchpad, as for `spec:prepare`).
 */

import { PROPOSALS } from './proposals.ts';

const [suite, out] = Deno.args;
if (suite === undefined || out === undefined) {
  console.error('usage: deno task proposals <testsuite-main> <outDir>');
  Deno.exit(2);
}

const here = (f: string) => new URL(f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Runs `deno <args>`; its exit status and the output's last meaningful lines. */
async function deno(args: string[]): Promise<{ ok: boolean; tail: string[] }> {
  // NO_COLOR: the output is relayed and filtered, so no escape codes in it.
  const r = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: 'piped',
    stderr: 'piped',
    env: { NO_COLOR: '1' },
  }).output();
  const text = new TextDecoder().decode(new Uint8Array([...r.stdout, ...r.stderr]));
  return { ok: r.success, tail: text.split('\n').filter((l) => l.trim() !== '') };
}

let failed = 0;
const summary: string[] = [];
for (const p of PROPOSALS) {
  const dir = `${out}/${p.name}`;
  console.log(`\n===== proposals/${p.name}`);

  const prep = await deno([
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-run',
    '--allow-env',
    here('./spec-prepare.ts'),
    `${suite}/proposals/${p.name}`,
    dir,
  ]);
  if (!prep.ok) {
    console.log(prep.tail.slice(-5).join('\n'));
    summary.push(`${p.name.padEnd(20)} PREPARE FAILED`);
    failed++;
    continue;
  }

  const validity = await deno([
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    here('./spec-testsuite.ts'),
    dir,
    '--proposal',
    p.name,
  ]);
  console.log(validity.tail.filter((l) => !l.startsWith('Task')).join('\n'));

  let behaviour: string;
  if (p.noEngine !== undefined) {
    behaviour = `NOT RUN — ${p.noEngine}`;
    console.log(`  behaviour: ${behaviour}`);
  } else {
    const flags = p.v8Flags.length > 0 ? [`--v8-flags=${p.v8Flags.join(',')}`] : [];
    const b = await deno([
      'run',
      '--allow-read',
      ...flags,
      ...(p.behaviourScript !== undefined
        ? [here(p.behaviourScript), dir]
        : [here('./check-spec-behaviour.ts'), dir, '--proposal', p.name]),
    ]);
    console.log(b.tail.join('\n'));
    behaviour = b.ok ? 'ok' : 'FAILED';
    if (!b.ok) failed++;
  }
  if (!validity.ok) failed++;
  summary.push(
    `${p.name.padEnd(20)} validity ${validity.ok ? 'ok    ' : 'FAILED'}  behaviour ${behaviour}` +
      (p.v8Flags.length > 0 ? `  (${p.v8Flags.join(' ')})` : ''),
  );
}

console.log('\n  === proposals/ ===');
for (const s of summary) console.log(`    ${s}`);
console.log(failed === 0 ? '\n  every proposal holds' : `\n  ✗ ${failed} step(s) failed`);
Deno.exit(failed === 0 ? 0 : 1);
