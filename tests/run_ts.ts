// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// Run a TypeScript entry (`main.ts`, a script) as a CHILD of whichever runtime is running the
// tests, the way that runtime runs one (Bun migration B5, 2026-10-13): the CLI tests then check
// the CLI under Node, Bun and Deno alike. Node runs `.ts` itself since 22.18 (erasable TypeScript:
// open-work 28 part 4); Bun always has; Deno needs `run -A`.

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The command line that runs `file` with `args` on the current runtime. */
export function tsCommand(file: string | URL, args: readonly string[]): [string, string[]] {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  const deno = 'Deno' in globalThis;
  return [process.execPath, deno ? ['run', '-A', '--quiet', path, ...args] : [path, ...args]];
}

/** Run `file` with `args` on the current runtime; its exit code and output. */
export function runTs(
  file: string | URL,
  args: readonly string[],
  options: { cwd?: string; input?: string | Uint8Array } = {},
): { code: number; stdout: string; stderr: string } {
  const [cmd, argv] = tsCommand(file, args);
  const r = spawnSync(cmd, argv, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

/** {@link runTs}, without blocking: the child runs while other tests do. */
export function runTsAsync(
  file: string | URL,
  args: readonly string[],
  options: { cwd?: string; input?: string | Uint8Array } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [cmd, argv] = tsCommand(file, args);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: options.cwd });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(options.input);
  });
}
