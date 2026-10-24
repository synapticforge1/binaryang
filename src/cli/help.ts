// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * `<tool> --help`, in upstream wabt's layout (open-work 36; owner, 2026-10-24: "add the help to the
 * cli tools and the needed information to go with it"): a usage line, what the tool does, examples,
 * then every option it accepts. Printed to stdout, exit 0, as upstream. One renderer for every
 * tool, and the feature flags generated from D2, so a help text cannot list a flag the parser does
 * not take.
 *
 * @module
 */

import { FEATURE_DEFINITIONS } from '../definitions/mod.ts';

/** What `--help` says about one tool. */
export interface ToolHelp {
  /** `usage: <this>` — the tool name and its arguments. */
  usage: string;
  /** What the tool does, one paragraph. */
  description: string;
  /** `[comment, command]` pairs. */
  examples: [string, string][];
  /** `[flags, meaning]`, in the order the help lists them. */
  options: [string, string][];
  /** Append the `--enable-` / `--disable-` feature flags (the tools that validate). */
  features?: boolean;
}

/** The feature flags, as wabt lists them: the switch AWAY from each feature's default. */
function featureOptions(): [string, string][] {
  const out: [string, string][] = [['--enable-all', 'Enable every feature']];
  for (const f of FEATURE_DEFINITIONS.entries) {
    const flag = f.defaultOn ? `--disable-${f.cli}` : `--enable-${f.cli}`;
    const what = `${f.defaultOn ? 'Disable' : 'Enable'} ${f.cli} (${
      f.defaultOn ? 'on' : 'off'
    } by default)`;
    out.push([flag, f.implemented ? what : `${what}; declared, changes nothing`]);
  }
  return out;
}

/** The help text, in wabt's layout. */
export function helpText(h: ToolHelp): string {
  const options: [string, string][] = [
    ['--help', 'Print this help message'],
    ['--version', 'Print version information'],
    ...h.options,
    ...(h.features ? featureOptions() : []),
  ];
  const width = Math.max(...options.map(([f]) => f.length)) + 2;
  return [
    `usage: ${h.usage}`,
    '',
    ...h.description.split('\n').map((l) => `  ${l}`),
    '',
    'examples:',
    ...h.examples.flatMap((
      [comment, cmd],
      i,
    ) => [...(i > 0 ? [''] : []), `  # ${comment}`, `  $ ${cmd}`]),
    '',
    'options:',
    // A short flag written first ("-o, --output") keeps wabt's column: long flags are indented.
    ...options.map(([f, m]) => `  ${(f.startsWith('--') ? `    ${f}` : f).padEnd(width + 4)}${m}`),
  ].join('\n');
}

/** Whether `args` asks for help: `--help`, as upstream (`-h` means other things in some tools). */
export function wantsHelp(args: readonly string[]): boolean {
  return args.includes('--help');
}
