// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * D1 against the WebAssembly specification, durably (open-work 34; cmem/definitions.md § "D1 against
 * the specification"). D1's opcodes came to binaryang through wabt-ts's port of wabt; their content
 * is facts of the specification. This keeps it so:
 *
 * - `refresh <dir>` reads the specification's own sources — local checkouts of WebAssembly/spec,
 *   threads, wide-arithmetic and custom-descriptors under `<dir>` — and writes the extracted facts,
 *   with each source's repository, commit, file and licence, to
 *   `tests/definitions/spec-opcodes.snapshot.json`. Run by hand when the specification moves.
 * - The CHECK ({@link compareWithSpec}) needs only that snapshot: every D1 opcode is defined by a
 *   source under the same name, and every opcode a source defines is in D1 — except the known
 *   differences, each listed with its reason. `tests/definitions/spec_opcodes.test.ts` runs it, so
 *   CI does.
 *
 *   bun scripts/spec-opcodes.ts refresh <dir>   # <dir>/spec, <dir>/threads, … (git checkouts)
 *   bun scripts/spec-opcodes.ts check           # D1 against the committed snapshot
 *
 * The sources' text is not copied: only opcode numbers and mnemonics, facts, with attribution.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const REPO = new URL('..', import.meta.url);
export const SNAPSHOT = new URL('tests/definitions/spec-opcodes.snapshot.json', REPO);

/** One opcode a source defines. `prefix`: the prefix byte as hex (`0xfd`), or `null`. */
export interface SpecOpcode {
  source: string;
  prefix: string | null;
  opcode: number;
  name: string;
}
/** A difference between D1 and the sources that is understood, and accepted, with its reason. */
export interface KnownDifference {
  prefix: string | null;
  opcode: number;
  spec: string;
  d1: string;
  reason: string;
}
export interface SpecSnapshot {
  about: string;
  sources: {
    name: string;
    repository: string;
    commit: string;
    date: string;
    files: string[];
    licence: string;
  }[];
  known: KnownDifference[];
  opcodes: SpecOpcode[];
}

/**
 * The differences found 2026-10-23 and accepted (cmem/definitions.md): the spec's instruction INDEX
 * names two relaxed truncations by their abstract syntax, where the TEXT format — the spec's own
 * testsuite and SpecTec — writes D1's `_zero` names.
 */
const KNOWN: KnownDifference[] = [
  {
    prefix: '0xfd',
    opcode: 0x103,
    spec: 'i32x4.relaxed_trunc_f64x2_s',
    d1: 'i32x4.relaxed_trunc_f64x2_s_zero',
    reason:
      "the instruction index's abstract-syntax name; the text format (spec testsuite, SpecTec) writes _zero",
  },
  {
    prefix: '0xfd',
    opcode: 0x104,
    spec: 'i32x4.relaxed_trunc_f64x2_u',
    d1: 'i32x4.relaxed_trunc_f64x2_u_zero',
    reason:
      "the instruction index's abstract-syntax name; the text format (spec testsuite, SpecTec) writes _zero",
  },
];

/** D1's rule: a name may carry its form (`ref.test null`); the spec names both forms alike. */
const sameName = (spec: string, d1: string) => spec === d1 || `${spec} null` === d1;
const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const key = (prefix: string | null, opcode: number) => `${prefix ?? ''}:${opcode}`;

type D1Entry = { name: string; prefix: string | null; opcode: number };

/** Every difference between D1 and the snapshot that is NOT a known one. Empty: they agree. */
export function compareWithSpec(d1: readonly D1Entry[], snap: SpecSnapshot): string[] {
  const problems: string[] = [];
  const spec = new Map<string, SpecOpcode[]>();
  for (const s of snap.opcodes) {
    spec.set(key(s.prefix, s.opcode), [...(spec.get(key(s.prefix, s.opcode)) ?? []), s]);
  }
  const known = new Map(snap.known.map((k) => [key(k.prefix, k.opcode), k]));
  const d1Keys = new Set<string>();
  for (const e of d1) {
    const k = key(e.prefix, e.opcode);
    d1Keys.add(k);
    const defs = spec.get(k);
    if (defs === undefined) {
      problems.push(
        `D1 ${e.name} (${e.prefix ?? ''} ${hex(e.opcode)}): no source defines this opcode`,
      );
      continue;
    }
    if (defs.some((s) => sameName(s.name, e.name))) continue;
    const kd = known.get(k);
    if (kd !== undefined && kd.d1 === e.name && defs.some((s) => s.name === kd.spec)) continue;
    problems.push(
      `D1 ${e.name} (${e.prefix ?? ''} ${hex(e.opcode)}): the sources name it ${
        defs.map((s) => `${s.name} [${s.source}]`).join(', ')
      }`,
    );
  }
  for (const [k, defs] of spec) {
    if (!d1Keys.has(k)) {
      problems.push(
        `${defs[0]!.name} (${defs[0]!.prefix ?? ''} ${hex(defs[0]!.opcode)}, ${
          defs[0]!.source
        }): not in D1`,
      );
    }
  }
  return problems;
}

// --- refresh: extraction from the sources (the one-time proof's method, 2026-10-23) ---

function gitInfo(dir: string): { commit: string; date: string; repository: string } {
  const g = (...a: string[]) =>
    spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).stdout.trim();
  return {
    commit: g('rev-parse', 'HEAD'),
    date: g('log', '-1', '--format=%cs'),
    repository: g('remote', 'get-url', 'origin'),
  };
}

/** The spec's instruction index, names through its macro file. */
function fromSpecIndex(spec: string): SpecOpcode[] {
  const macros = new Map<string, string>();
  const kText = (s: string) =>
    s.replace(/\\scriptstyle\s*/g, '').replace(/\{\.\}/g, '.').replace(/\\_/g, '_').replace(
      /[{}]/g,
      '',
    );
  for (
    const m of readFileSync(`${spec}/document/core/util/macros.def`, 'utf8').matchAll(
      /^\.\. \|(\w+)\| mathdef:: (.*)$/gm,
    )
  ) {
    const k = m[2]!.match(/\\K\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/);
    if (k) macros.set(m[1]!, kText(k[1]!));
  }
  const decode = (tex: string) =>
    tex.split('~')[0]!
      // Macros first (a name ends at the next backslash), then an inline \K{8\_s}.
      .replace(/\\(?!K\{)([A-Za-z][A-Za-z0-9]*)/g, (_, n: string) => {
        const v = macros.get(n);
        if (v === undefined) throw new Error(`unresolved macro \\${n}`);
        return v;
      })
      .replace(/\\K\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, t: string) => kText(t))
      .replace(/\s+/g, '');
  const out: SpecOpcode[] = [];
  const src = readFileSync(`${spec}/document/core/appendix/index-instructions.py`, 'utf8');
  for (const m of src.matchAll(/Instruction\(([\d.]+), (None|r'([^']*)'), r'([^']*)'/g)) {
    if (m[2] === 'None' || m[4]!.includes('\\dots')) continue; // reserved, or a reserved RANGE
    const bytes = [...m[4]!.matchAll(/\\hex\{([0-9A-F]{2})\}/g)].map((x) => parseInt(x[1]!, 16));
    let prefix: string | null = null;
    let opcode = bytes[0]!;
    if (bytes.length > 1) {
      prefix = hex(bytes[0]!);
      opcode = 0;
      bytes.slice(1).forEach((b, i) => (opcode |= (b & 0x7f) << (7 * i)));
    }
    out.push({ source: 'spec', prefix, opcode, name: decode(m[3]!) });
  }
  return out;
}

/** A proposal's binary grammar: `| 0xFE 0x10 m:memarg => i32.atomic.load m` or `| 0xFC 19:u32 ⇒ …`. */
function fromGrammar(source: string, file: string): SpecOpcode[] {
  const out: SpecOpcode[] = [];
  const text = readFileSync(file, 'utf8');
  for (
    const m of text.matchAll(
      /\|\s*0x([0-9A-Fa-f]{2})\s+(?:0x([0-9A-Fa-f]{2})|(\d+):u32)([^|]*?)(?:=>|⇒)\s*([a-z][a-z0-9_.]*)([^\n]*)/g,
    )
  ) {
    const name = m[5]! + (/^\s*\(ref null/.test(m[6]!) ? ' null' : '');
    out.push({
      source,
      prefix: hex(parseInt(m[1]!, 16)),
      opcode: m[2] ? parseInt(m[2], 16) : Number(m[3]),
      name,
    });
  }
  return out;
}

/** Legacy exception handling: a Markdown table, `| \`try\` | \`0x06\` |`. */
function fromLegacyEh(file: string): SpecOpcode[] {
  return [...readFileSync(file, 'utf8').matchAll(/^\| `([a-z_]+)` \| `0x([0-9a-f]{2})` \|/gm)].map((
    m,
  ) => ({
    source: 'legacy-exceptions',
    prefix: null,
    opcode: parseInt(m[2]!, 16),
    name: m[1]!,
  }));
}

function refresh(dir: string): SpecSnapshot {
  const W3C = 'W3C Software and Document License (https://www.w3.org/copyright/software-license/)';
  const CC0 = 'CC0 1.0 Universal';
  const src = (name: string, sub: string, files: string[], licence: string) => ({
    name,
    ...gitInfo(`${dir}/${sub}`),
    files,
    licence,
  });
  const opcodes = [
    ...fromSpecIndex(`${dir}/spec`),
    ...fromGrammar('threads', `${dir}/threads/proposals/threads/Overview.md`),
    ...fromGrammar(
      'wide-arithmetic',
      `${dir}/wide-arithmetic/proposals/wide-arithmetic/Overview.md`,
    ),
    ...fromGrammar(
      'custom-descriptors',
      `${dir}/custom-descriptors/proposals/custom-descriptors/Overview.md`,
    ),
    ...fromLegacyEh(`${dir}/spec/proposals/exception-handling/legacy/Exceptions.md`),
  ];
  return {
    about:
      'Opcode numbers and mnemonics extracted from the WebAssembly specification sources below (facts, with attribution) by scripts/spec-opcodes.ts refresh. Not shipped. D1 (src/definitions/opcodes.json) must agree; tests/definitions/spec_opcodes.test.ts checks it.',
    sources: [
      src('spec', 'spec', [
        'document/core/appendix/index-instructions.py',
        'document/core/util/macros.def',
      ], W3C),
      src('threads', 'threads', ['proposals/threads/Overview.md'], CC0),
      src('wide-arithmetic', 'wide-arithmetic', ['proposals/wide-arithmetic/Overview.md'], CC0),
      src(
        'custom-descriptors',
        'custom-descriptors',
        ['proposals/custom-descriptors/Overview.md'],
        CC0,
      ),
      src('legacy-exceptions', 'spec', ['proposals/exception-handling/legacy/Exceptions.md'], CC0),
    ],
    known: KNOWN,
    opcodes,
  };
}

if (import.meta.main) {
  const [mode, dir] = process.argv.slice(2);
  const d1 = (JSON.parse(readFileSync(new URL('src/definitions/opcodes.json', REPO), 'utf8')) as {
    entries: D1Entry[];
  }).entries;
  if (mode === 'refresh' && dir !== undefined) {
    const snap = refresh(dir);
    writeFileSync(SNAPSHOT, `${JSON.stringify(snap, null, 2)}\n`);
    const problems = compareWithSpec(d1, snap);
    console.log(
      `refreshed: ${snap.opcodes.length} opcodes from ${snap.sources.length} sources; D1 ${d1.length} entries`,
    );
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (mode === 'check') {
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as SpecSnapshot;
    const problems = compareWithSpec(d1, snap);
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log(
      problems.length === 0
        ? `D1 agrees with the specification: ${d1.length} opcodes`
        : `${problems.length} difference(s)`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  } else {
    console.error('usage: bun scripts/spec-opcodes.ts refresh <dir> | check');
    process.exit(2);
  }
}
